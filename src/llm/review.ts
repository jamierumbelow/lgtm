import { z } from "zod";
import { loadPrompt, generateStructured } from "./client.js";
import {
  FileDiff,
  DiffHunk,
  ChangeGroup,
  RiskLevel,
  ReviewSuggestion,
  parseDiff,
  extractNewSymbolInfos,
  extractModifiedSymbolInfos,
} from "../analysis/chunker.js";
import { createStableChangeGroupId } from "../analysis/change-id.js";
import { trimHunkContent } from "./diff-context.js";
import { isLLMExcludedFile, isLockfilePath } from "./file-filters.js";
import { ModelChoice, getDefaultModel } from "../config.js";

// --- Zod Schemas ---

const SuggestionSchema = z.object({
  severity: z.enum(["nit", "suggestion", "important", "critical"]),
  text: z.string(),
  file: z.string().optional(),
});

const ChangesetWithReviewSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  changeType: z.enum([
    "feature",
    "bugfix",
    "refactor",
    "test",
    "docs",
    "config",
    "types",
    "chore",
  ]),
  files: z.array(z.string()),
  hunkRefs: z.array(z.string()),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  verdict: z.string(),
  suggestions: z.array(SuggestionSchema),
});

const CombinedReviewResponseSchema = z.object({
  changesets: z.array(ChangesetWithReviewSchema),
  summary: z.string(),
  reviewGuidance: z.string(),
});

type ChangesetWithReview = z.infer<typeof ChangesetWithReviewSchema>;

// --- Public API ---

export interface ReviewDiffOptions {
  model?: ModelChoice;
  verbose?: boolean;
  onProgress?: (info: { step: string }) => void;
}

export interface ReviewDiffResult {
  changeGroups: ChangeGroup[];
  summary?: string;
  reviewGuidance?: string;
}

/**
 * Single-pass review: splits the diff into changesets, generates verdicts
 * and suggestions, and produces the executive summary — all in one LLM call.
 */
export async function reviewDiffWithLLM(
  diff: string,
  options: ReviewDiffOptions = {}
): Promise<ReviewDiffResult> {
  const fileDiffs = parseDiff(diff);

  if (fileDiffs.length === 0) {
    return { changeGroups: [] };
  }

  const [eligibleDiffs, excludedDiffs] = partitionFileDiffs(fileDiffs);
  const excludedGroup = buildExcludedGroup(excludedDiffs);

  if (eligibleDiffs.length === 0) {
    return { changeGroups: excludedGroup ? [excludedGroup] : [] };
  }

  options.onProgress?.({ step: "Reviewing diff (single pass)..." });

  const systemPrompt = loadPrompt(
    "review/review.v1.txt",
    options.model ?? getDefaultModel()
  );
  const userPrompt = buildUserPrompt(fileDiffs, excludedDiffs);

  const response = await generateStructured(
    systemPrompt,
    userPrompt,
    CombinedReviewResponseSchema,
    {
      temperature: 0.1,
      maxTokens: 16384,
      model: options.model ?? getDefaultModel(),
      verbose: options.verbose,
    }
  );

  const changeGroups = mapToChangeGroups(response.changesets, eligibleDiffs);

  if (excludedGroup) {
    changeGroups.push(excludedGroup);
  }

  return {
    changeGroups,
    summary: response.summary?.trim() || undefined,
    reviewGuidance: response.reviewGuidance?.trim() || undefined,
  };
}

// --- Prompt building ---

function buildUserPrompt(
  fileDiffs: FileDiff[],
  excludedDiffs: FileDiff[]
): string {
  const fileList = fileDiffs.map((f) => `- ${f.path} (${f.status})`).join("\n");
  const excludedFiles = excludedDiffs.map((f) => f.path);

  let diffContent = "";
  for (const file of fileDiffs) {
    if (excludedFiles.includes(file.path)) continue;
    diffContent += `\n=== ${file.path} ===\n`;
    file.hunks.forEach((hunk, i) => {
      diffContent += `\n[Hunk ${i}] @@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.header}\n`;
      diffContent += trimHunkContent(hunk.content, 1) + "\n";
    });
  }

  const excludedNote = excludedFiles.length
    ? `\n## Diff Omitted (generated or lockfiles)\n\n${excludedFiles
        .map((file) => `- ${file}`)
        .join("\n")}\n`
    : "";

  return `## Files Changed

${fileList}

${excludedNote}
## Unified Diff

${diffContent}

Please analyze this diff and split it into logical changesets.`;
}

// --- File partitioning ---

function partitionFileDiffs(fileDiffs: FileDiff[]): [FileDiff[], FileDiff[]] {
  const eligible: FileDiff[] = [];
  const excluded: FileDiff[] = [];

  for (const fileDiff of fileDiffs) {
    if (isLLMExcludedFile(fileDiff.path)) {
      excluded.push(fileDiff);
    } else {
      eligible.push(fileDiff);
    }
  }

  return [eligible, excluded];
}

// --- Response mapping ---

function mapToChangeGroups(
  changesets: ChangesetWithReview[],
  fileDiffs: FileDiff[]
): ChangeGroup[] {
  const hunkLookup = new Map<string, { file: string; hunk: DiffHunk }>();
  for (const file of fileDiffs) {
    file.hunks.forEach((hunk, i) => {
      hunkLookup.set(`${file.path}:${i}`, { file: file.path, hunk });
    });
  }

  return changesets.map((cs) => {
    const hunks: Array<{ file: string; hunk: DiffHunk }> = [];
    for (const ref of cs.hunkRefs) {
      const hunkData = hunkLookup.get(ref);
      if (hunkData) hunks.push(hunkData);
    }

    const changeType = normalizeChangeType(cs.changeType);
    const fileDiffs = hunksToFileDiffs(hunks);
    const symbolsIntroduced = extractNewSymbols(hunks);
    const symbolsModified = extractModifiedSymbols(hunks);
    const symbolsIntroducedInfo = extractNewSymbolInfos(fileDiffs);
    const symbolsModifiedInfo = extractModifiedSymbolInfos(fileDiffs);

    // Map risk level
    const riskLevel: RiskLevel = (
      ["low", "medium", "high", "critical"].includes(cs.riskLevel)
        ? cs.riskLevel
        : "medium"
    ) as RiskLevel;

    // Map suggestions
    const suggestions: ReviewSuggestion[] = (cs.suggestions ?? []).map((s) => ({
      severity: s.severity,
      text: s.text.trim(),
      file: s.file,
    }));

    return {
      id: createStableChangeGroupId({ files: cs.files, hunks }),
      title: cs.title,
      description: cs.description,
      files: cs.files,
      hunks,
      changeType,
      symbolsIntroduced,
      symbolsModified,
      symbolsIntroducedInfo,
      symbolsModifiedInfo,
      riskLevel,
      verdict: cs.verdict?.trim() || undefined,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
    };
  });
}

function normalizeChangeType(raw: string): ChangeGroup["changeType"] {
  const map: Record<string, ChangeGroup["changeType"]> = {
    feature: "feature",
    bugfix: "bugfix",
    refactor: "refactor",
    test: "test",
    docs: "docs",
    config: "config",
    types: "types",
    chore: "chore",
  };
  return map[raw] ?? "unknown";
}

function buildExcludedGroup(excludedDiffs: FileDiff[]): ChangeGroup | null {
  if (excludedDiffs.length === 0) return null;

  const files = excludedDiffs.map((f) => f.path);
  const hunks = excludedDiffs.flatMap((file) =>
    file.hunks.map((hunk) => ({ file: file.path, hunk }))
  );
  const allLockfiles = files.every((file) => isLockfilePath(file));

  return {
    id: createStableChangeGroupId({ files, hunks }),
    title: "Generated/lockfiles",
    description: "Diff omitted from LLM prompts.",
    files,
    hunks,
    changeType: allLockfiles ? "config" : "unknown",
    symbolsIntroduced: extractNewSymbols(hunks),
    symbolsModified: extractModifiedSymbols(hunks),
    symbolsIntroducedInfo: extractNewSymbolInfos(excludedDiffs),
    symbolsModifiedInfo: extractModifiedSymbolInfos(excludedDiffs),
  };
}

// --- Helpers ---

/** Group flat hunk array into FileDiff[] so we can reuse chunker's SymbolInfo extractors */
function hunksToFileDiffs(
  hunks: Array<{ file: string; hunk: DiffHunk }>
): FileDiff[] {
  const byFile = new Map<string, DiffHunk[]>();
  for (const { file, hunk } of hunks) {
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file)!.push(hunk);
  }
  return [...byFile.entries()].map(([path, fileHunks]) => ({
    path,
    status: "modified" as FileDiff["status"],
    hunks: fileHunks,
  }));
}

// --- Symbol extraction ---

function extractNewSymbols(
  hunks: Array<{ file: string; hunk: DiffHunk }>
): string[] {
  const symbols: string[] = [];
  for (const { hunk } of hunks) {
    const addedLines = hunk.content
      .split("\n")
      .filter((l) => l.startsWith("+"))
      .map((l) => l.slice(1));

    for (const line of addedLines) {
      const funcMatch = line.match(/(?:function|const|let|var)\s+(\w+)\s*[=(]/);
      if (funcMatch) symbols.push(funcMatch[1]);

      const classMatch = line.match(/class\s+(\w+)/);
      if (classMatch) symbols.push(classMatch[1]);

      const typeMatch = line.match(/(?:type|interface)\s+(\w+)/);
      if (typeMatch) symbols.push(typeMatch[1]);

      const pyMatch = line.match(/(?:def|class)\s+(\w+)/);
      if (pyMatch) symbols.push(pyMatch[1]);
    }
  }
  return [...new Set(symbols)];
}

function extractModifiedSymbols(
  hunks: Array<{ file: string; hunk: DiffHunk }>
): string[] {
  const symbols: string[] = [];
  for (const { hunk } of hunks) {
    if (hunk.header) {
      const funcMatch = hunk.header.match(/(?:function|def|class)\s+(\w+)/);
      if (funcMatch) symbols.push(funcMatch[1]);
    }
  }
  return [...new Set(symbols)];
}
