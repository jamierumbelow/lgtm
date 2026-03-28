#!/usr/bin/env bun
/**
 * Render the review HTML from prepared diff + analysis JSON files.
 * Usage: bun scripts/render.ts [diffPath] [analysisPath] [outputPath]
 * Defaults: /tmp/lgtm-diff.json /tmp/lgtm-analysis.json /tmp/lgtm-review.html
 */

import { readFileSync, writeFileSync } from "fs";
import { renderHTML } from "../src/output/html.ts";
import { createStableChangeGroupId } from "../src/analysis/change-id.ts";
import { isLockfilePath } from "../src/llm/file-filters.ts";
import type { Analysis } from "../src/analysis/analyzer.ts";
import type {
  ChangeGroup,
  FileDiff,
  DiffHunk,
  RiskLevel,
  ReviewSuggestion,
} from "../src/analysis/chunker.ts";

const VALID_RISK_LEVELS = new Set(["low", "medium", "high", "critical"]);
const VALID_CHANGE_TYPES = new Set([
  "feature", "bugfix", "refactor", "test", "docs", "config", "types", "chore", "unknown",
]);

export interface RawChangeset {
  id: string;
  title: string;
  description?: string;
  changeType: string;
  files: string[];
  hunkRefs: string[];
  riskLevel: string;
  verdict?: string;
  suggestions?: Array<{ severity: string; text: string; file?: string }>;
}

export interface DiffData {
  empty: boolean;
  meta: {
    baseBranch: string;
    headBranch: string;
    filesChanged: number;
    additions: number;
    deletions: number;
    excludedFiles: string[];
  } | null;
  fileDiffs: FileDiff[];
}

export interface AnalysisData {
  changesets: RawChangeset[];
  summary?: string;
  reviewGuidance?: string;
}

export function buildHunkLookup(
  fileDiffs: FileDiff[]
): Map<string, { file: string; hunk: DiffHunk }> {
  const lookup = new Map<string, { file: string; hunk: DiffHunk }>();
  for (const file of fileDiffs) {
    (file.hunks as DiffHunk[]).forEach((hunk, i) => {
      lookup.set(`${file.path}:${i}`, { file: file.path, hunk });
    });
  }
  return lookup;
}

export function mapChangeset(
  cs: RawChangeset,
  hunkLookup: Map<string, { file: string; hunk: DiffHunk }>
): ChangeGroup {
  const hunks: Array<{ file: string; hunk: DiffHunk }> = [];
  for (const ref of cs.hunkRefs ?? []) {
    const entry = hunkLookup.get(ref);
    if (entry) hunks.push(entry);
  }

  const riskLevel: RiskLevel = VALID_RISK_LEVELS.has(cs.riskLevel)
    ? (cs.riskLevel as RiskLevel)
    : "medium";

  const changeType = VALID_CHANGE_TYPES.has(cs.changeType)
    ? (cs.changeType as ChangeGroup["changeType"])
    : "unknown";

  const suggestions: ReviewSuggestion[] = (cs.suggestions ?? []).map((s) => ({
    severity: s.severity as ReviewSuggestion["severity"],
    text: s.text,
    file: s.file,
  }));

  return {
    id: createStableChangeGroupId({ files: cs.files, hunks }),
    title: cs.title,
    description: cs.description,
    files: cs.files,
    hunks,
    changeType,
    riskLevel,
    verdict: cs.verdict,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
    symbolsIntroduced: [],
    symbolsModified: [],
    symbolsIntroducedInfo: [],
    symbolsModifiedInfo: [],
  } satisfies ChangeGroup;
}

export function buildExcludedGroup(excludedFiles: string[]): ChangeGroup {
  const allLockfiles = excludedFiles.every((f) => isLockfilePath(f));
  return {
    id: createStableChangeGroupId({ files: excludedFiles, hunks: [] }),
    title: "Generated/lockfiles",
    description: "Diff omitted from LLM prompts.",
    files: excludedFiles,
    hunks: [],
    changeType: allLockfiles ? "config" : "unknown",
    symbolsIntroduced: [],
    symbolsModified: [],
    symbolsIntroducedInfo: [],
    symbolsModifiedInfo: [],
  };
}

export function buildAnalysis(
  diffData: DiffData,
  analysisData: AnalysisData
): Analysis {
  const { meta, fileDiffs } = diffData;
  if (!meta) throw new Error("meta is null — diff data appears to be empty");

  const hunkLookup = buildHunkLookup(fileDiffs);
  const changeGroups = (analysisData.changesets ?? []).map((cs) =>
    mapChangeset(cs, hunkLookup)
  );

  if (meta.excludedFiles?.length > 0) {
    changeGroups.push(buildExcludedGroup(meta.excludedFiles));
  }

  return {
    baseBranch: meta.baseBranch,
    headBranch: meta.headBranch,
    analyzedAt: new Date(),
    filesChanged: meta.filesChanged,
    additions: meta.additions,
    deletions: meta.deletions,
    changeGroups,
    summary: analysisData.summary,
    reviewGuidance: analysisData.reviewGuidance,
    contributors: [],
    suggestedReviewers: [],
  };
}

export function renderEmptyPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>No Changes to Review</title>
  <style>
    body { background: #0d1117; color: #e6edf3; font-family: -apple-system, sans-serif;
           display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .msg { text-align: center; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    p { color: #8b949e; }
  </style>
</head>
<body>
  <div class="msg">
    <h1>Nothing to Review</h1>
    <p>No uncommitted or branch changes were found.</p>
  </div>
</body>
</html>`;
}

// --- Main (only runs when executed directly) ---

if (import.meta.main) {
  const diffPath = process.argv[2] ?? "/tmp/lgtm-diff.json";
  const analysisPath = process.argv[3] ?? "/tmp/lgtm-analysis.json";
  const outputPath = process.argv[4] ?? "/tmp/lgtm-review.html";

  const diffData: DiffData = JSON.parse(readFileSync(diffPath, "utf-8"));
  const analysisData: AnalysisData = JSON.parse(readFileSync(analysisPath, "utf-8"));

  if (diffData.empty) {
    writeFileSync(outputPath, renderEmptyPage());
    console.log("Nothing to review. Wrote empty page to", outputPath);
    process.exit(0);
  }

  const analysis = buildAnalysis(diffData, analysisData);
  const html = renderHTML(analysis);
  writeFileSync(outputPath, html);
  console.log("Wrote review HTML to", outputPath);
}
