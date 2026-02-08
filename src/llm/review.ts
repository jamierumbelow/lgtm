import { z } from "zod";
import { loadPrompt, generateStructured } from "./client.js";
import {
  FileDiff,
  DiffHunk,
  ChangeGroup,
  RiskLevel,
  ReviewSuggestion,
  parseDiff,
} from "../analysis/chunker.js";
import { createStableChangeGroupId } from "../analysis/change-id.js";
import { trimHunkContent } from "./diff-context.js";
import { isLLMExcludedFile, isLockfilePath } from "./file-filters.js";
import type { ReviewQuestion } from "../analysis/analyzer.js";
import { ModelChoice, DEFAULT_MODEL } from "../config.js";

// All review question IDs — every changeset gets all questions answered
// in the single combined call. We filter irrelevant ones post-hoc.
const ALL_QUESTION_IDS = [
  "failure-modes",
  "input-domain",
  "duplication",
  "abstractions",
  "invariants",
  "error-handling",
  "testing",
  "performance",
  "security-privacy",
  "compatibility",
  "observability",
] as const;

type QuestionId = (typeof ALL_QUESTION_IDS)[number];

const QUESTION_LABELS: Record<QuestionId, string> = {
  "failure-modes": "How can this fail? What's already handled?",
  "input-domain": "What inputs does this change handle?",
  duplication: "Does this add duplication?",
  abstractions: "Do the abstractions make sense?",
  invariants: "What invariants change or are added?",
  "error-handling": "Are error paths fully handled?",
  testing: "What tests were added or updated? What's untested?",
  performance: "Any impact on latency, memory, or complexity?",
  "security-privacy": "Does this touch sensitive data or trust boundaries?",
  compatibility: "Any behavior or API changes that could break callers?",
  observability: "Do we need new or updated logs, metrics, or traces?",
};

// Which questions are relevant per changeset type — used for post-filtering
const RELEVANT_QUESTIONS: Readonly<
  Record<ChangeGroup["changeType"], readonly QuestionId[]>
> = {
  feature: ALL_QUESTION_IDS,
  bugfix: ["failure-modes", "error-handling", "testing", "compatibility"],
  refactor: ["abstractions", "duplication", "performance", "compatibility"],
  test: ["testing", "failure-modes"],
  config: ["compatibility", "testing"],
  docs: ["compatibility"],
  types: ["compatibility", "invariants"],
  unknown: ["failure-modes", "testing", "compatibility", "performance"],
};

// --- Zod Schemas ---

const ReviewAnswersSchema = z.object({
  "failure-modes": z.string(),
  "input-domain": z.string(),
  duplication: z.string(),
  abstractions: z.string(),
  invariants: z.string(),
  "error-handling": z.string(),
  testing: z.string(),
  performance: z.string(),
  "security-privacy": z.string(),
  compatibility: z.string(),
  observability: z.string(),
});

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
  review: ReviewAnswersSchema,
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  verdict: z.string(),
  suggestions: z.array(SuggestionSchema),
});

const CombinedReviewResponseSchema = z.object({
  changesets: z.array(ChangesetWithReviewSchema),
});

type ChangesetWithReview = z.infer<typeof ChangesetWithReviewSchema>;

// --- Public API ---

export interface ReviewDiffOptions {
  model?: ModelChoice;
  verbose?: boolean;
  onProgress?: (info: { step: string }) => void;
}

/**
 * Single-pass review: splits the diff into changesets AND answers all
 * review questions in one LLM call. Replaces the old two-phase pipeline
 * (splitChangesetsWithLLM → answerChangesetQuestionsWithLLM).
 */
export async function reviewDiffWithLLM(
  diff: string,
  options: ReviewDiffOptions = {}
): Promise<ChangeGroup[]> {
  const fileDiffs = parseDiff(diff);

  if (fileDiffs.length === 0) {
    return [];
  }

  const [eligibleDiffs, excludedDiffs] = partitionFileDiffs(fileDiffs);
  const excludedGroup = buildExcludedGroup(excludedDiffs);

  if (eligibleDiffs.length === 0) {
    return excludedGroup ? [excludedGroup] : [];
  }

  options.onProgress?.({ step: "Reviewing diff (single pass)..." });

  const systemPrompt = loadPrompt(
    "review/review.v1.txt",
    options.model ?? DEFAULT_MODEL
  );
  const userPrompt = buildUserPrompt(fileDiffs, excludedDiffs);

  const response = await generateStructured(
    systemPrompt,
    userPrompt,
    CombinedReviewResponseSchema,
    {
      temperature: 0.1,
      maxTokens: 16384,
      model: options.model ?? DEFAULT_MODEL,
      verbose: options.verbose,
    }
  );

  const changeGroups = mapToChangeGroups(response.changesets, eligibleDiffs);

  if (excludedGroup) {
    changeGroups.push(excludedGroup);
  }

  return changeGroups;
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

Please analyze this diff: split it into logical changesets and answer all review questions for each.`;
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
    const symbolsIntroduced = extractNewSymbols(hunks);
    const symbolsModified = extractModifiedSymbols(hunks);

    // Build review questions from the combined response, filtering to
    // only the questions relevant for this changeset type.
    const relevantIds = new Set(RELEVANT_QUESTIONS[changeType] ?? []);
    const reviewQuestions: ReviewQuestion[] = ALL_QUESTION_IDS.filter((id) =>
      relevantIds.has(id)
    ).map((id) => ({
      id,
      question: QUESTION_LABELS[id],
      category: "changeset" as const,
      model: DEFAULT_MODEL,
      answer: cs.review[id]?.trim() || undefined,
    }));

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
      reviewQuestions,
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
  };
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
