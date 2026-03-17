#!/usr/bin/env bun
/**
 * Prepare git diff data for the /review-diff skill.
 * Run from the target repo's CWD.
 * Writes /tmp/lgtm-diff.json
 */

import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { parseDiff } from "/home/tommy/code/personal/lgtm/src/analysis/chunker.ts";
import type { FileDiff } from "/home/tommy/code/personal/lgtm/src/analysis/chunker.ts";
import {
  isLLMExcludedFile,
} from "/home/tommy/code/personal/lgtm/src/llm/file-filters.ts";
import {
  isGitRepository,
  getDefaultBranch,
  getCurrentBranch,
  hasUncommittedChanges,
} from "/home/tommy/code/personal/lgtm/src/git/diff.ts";

export const OUTPUT_PATH = "/tmp/lgtm-diff.json";

export function tryRun(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 });
  } catch {
    return null;
  }
}

export function determineDiffCommand(): string {
  const defaultBranch = getDefaultBranch();
  const currentBranch = getCurrentBranch();
  const uncommitted = hasUncommittedChanges();

  if (currentBranch && currentBranch !== defaultBranch) {
    const mergeBase = tryRun(`git merge-base ${defaultBranch} HEAD`)?.trim();
    if (mergeBase) {
      return uncommitted ? `git diff ${mergeBase}` : `git diff ${mergeBase} HEAD`;
    }
  }

  if (uncommitted) {
    return "git diff HEAD";
  }

  return "git diff HEAD~1 HEAD";
}

export function getNumstat(
  diffCmd: string
): { additions: number; deletions: number } {
  const numstatCmd = diffCmd.replace(/^git diff/, "git diff --numstat");
  const output = tryRun(numstatCmd) ?? "";
  let additions = 0;
  let deletions = 0;
  for (const line of output.trim().split("\n")) {
    const parts = line.split("\t");
    if (parts.length >= 2) {
      additions += parseInt(parts[0]) || 0;
      deletions += parseInt(parts[1]) || 0;
    }
  }
  return { additions, deletions };
}

export function buildFormattedDiff(
  fileDiffs: FileDiff[],
  excludedPaths: Set<string>
): string {
  let out = "";
  for (const file of fileDiffs) {
    if (excludedPaths.has(file.path)) continue;
    out += `\n=== ${file.path} ===\n`;
    file.hunks.forEach((hunk, i) => {
      out += `\n[Hunk ${i}] @@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.header}\n`;
      out += hunk.content + "\n";
    });
  }
  return out;
}

export function buildDiffOutput(rawDiff: string): {
  empty: boolean;
  meta: object | null;
  fileDiffs: FileDiff[];
  formattedDiff: string;
} {
  if (!rawDiff.trim()) {
    return { empty: true, meta: null, fileDiffs: [], formattedDiff: "" };
  }

  const allFileDiffs = parseDiff(rawDiff);
  const excludedFiles: string[] = [];
  const eligibleFileDiffs = allFileDiffs.filter((f) => {
    if (isLLMExcludedFile(f.path)) {
      excludedFiles.push(f.path);
      return false;
    }
    return true;
  });

  const excludedPaths = new Set(excludedFiles);

  const fileListHeader =
    "## Files Changed\n\n" +
    allFileDiffs.map((f) => `- ${f.path} (${f.status})`).join("\n") +
    (excludedFiles.length
      ? "\n\n## Diff Omitted (generated or lockfiles)\n\n" +
        excludedFiles.map((p) => `- ${p}`).join("\n")
      : "") +
    "\n\n## Unified Diff\n";

  const formattedDiff =
    fileListHeader + buildFormattedDiff(eligibleFileDiffs, excludedPaths);

  const defaultBranch = getDefaultBranch();
  const currentBranch = getCurrentBranch();
  const diffCmd = determineDiffCommand();
  const { additions, deletions } = getNumstat(diffCmd);

  const meta = {
    baseBranch: defaultBranch,
    headBranch: currentBranch ?? "HEAD",
    filesChanged: allFileDiffs.length,
    additions,
    deletions,
    excludedFiles,
    diffCmd,
  };

  return { empty: false, meta, fileDiffs: eligibleFileDiffs, formattedDiff };
}

// --- Main (only runs when executed directly) ---

if (import.meta.main) {
  if (!isGitRepository()) {
    console.error("Error: not in a git repository");
    process.exit(1);
  }

  const diffCmd = determineDiffCommand();
  const rawDiff = tryRun(diffCmd) ?? "";
  const output = buildDiffOutput(rawDiff);

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  if (output.empty) {
    console.log("No changes found. Wrote empty sentinel to", OUTPUT_PATH);
  } else {
    const meta = output.meta as { filesChanged: number; additions: number; deletions: number };
    console.log(
      `Wrote diff data to ${OUTPUT_PATH} (${output.fileDiffs.length} files, ${meta.additions}+/${meta.deletions}-)`
    );
  }
}
