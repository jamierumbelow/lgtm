import { PRFile } from "../github/pr.js";
import type { ReviewQuestion } from "./analyzer.js";
import { splitChangesetsWithLLM } from "../llm/changeset-splitter.js";

export interface ChunkOptions {
  useLLM?: boolean;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
  header: string;
}

export interface FileDiff {
  path: string;
  previousPath?: string;
  status: PRFile["status"];
  hunks: DiffHunk[];
}

export interface ChangeGroup {
  id: string;
  title: string;
  description?: string; // Filled by LLM
  files: string[];
  hunks: Array<{ file: string; hunk: DiffHunk }>;
  symbolsIntroduced?: string[];
  symbolsModified?: string[];
  reviewQuestions?: ReviewQuestion[];
  changeType:
    | "feature"
    | "refactor"
    | "bugfix"
    | "test"
    | "config"
    | "docs"
    | "types"
    | "unknown";
}

/**
 * Parse a unified diff into structured file diffs
 */
export function parseDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  const lines = diff.split("\n");

  let currentFile: FileDiff | null = null;
  let currentHunk: DiffHunk | null = null;
  let hunkContent: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // New file header
    if (line.startsWith("diff --git")) {
      // Save previous hunk
      if (currentHunk && currentFile) {
        currentHunk.content = hunkContent.join("\n");
        currentFile.hunks.push(currentHunk);
      }

      // Parse file paths from diff header
      const match = line.match(/diff --git a\/(.*) b\/(.*)/);
      if (match) {
        currentFile = {
          path: match[2],
          previousPath: match[1] !== match[2] ? match[1] : undefined,
          status: "modified",
          hunks: [],
        };
        files.push(currentFile);
      }
      currentHunk = null;
      hunkContent = [];
      continue;
    }

    // File status indicators
    if (line.startsWith("new file mode") && currentFile) {
      currentFile.status = "added";
      continue;
    }
    if (line.startsWith("deleted file mode") && currentFile) {
      currentFile.status = "removed";
      continue;
    }
    if (line.startsWith("rename from") && currentFile) {
      currentFile.status = "renamed";
      continue;
    }

    // Hunk header
    const hunkMatch = line.match(
      /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/
    );
    if (hunkMatch && currentFile) {
      // Save previous hunk
      if (currentHunk) {
        currentHunk.content = hunkContent.join("\n");
        currentFile.hunks.push(currentHunk);
      }

      currentHunk = {
        oldStart: parseInt(hunkMatch[1]),
        oldLines: parseInt(hunkMatch[2] || "1"),
        newStart: parseInt(hunkMatch[3]),
        newLines: parseInt(hunkMatch[4] || "1"),
        header: hunkMatch[5].trim(),
        content: "",
      };
      hunkContent = [];
      continue;
    }

    // Hunk content
    if (
      currentHunk &&
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))
    ) {
      hunkContent.push(line);
    }
  }

  // Save final hunk
  if (currentHunk && currentFile) {
    currentHunk.content = hunkContent.join("\n");
    currentFile.hunks.push(currentHunk);
  }

  return files;
}

/**
 * Group diff hunks into logical change groups
 */
export async function chunkDiff(
  diff: string,
  files: PRFile[],
  options: ChunkOptions = {}
): Promise<ChangeGroup[]> {
  const { useLLM = false } = options;

  // Use LLM-powered splitting if enabled
  if (useLLM) {
    try {
      return await splitChangesetsWithLLM(diff);
    } catch (error) {
      console.warn("LLM chunking failed, falling back to heuristic:", error);
      // Fall through to heuristic approach
    }
  }

  // Heuristic fallback: group by directory/module
  return chunkDiffHeuristic(diff);
}

/**
 * Heuristic-based chunking (fallback when LLM is unavailable)
 */
export function chunkDiffHeuristic(diff: string): ChangeGroup[] {
  const fileDiffs = parseDiff(diff);
  const groups: ChangeGroup[] = [];

  // Strategy 1: Group by directory/module
  const byDirectory = new Map<string, FileDiff[]>();
  for (const fileDiff of fileDiffs) {
    const dir = getModulePath(fileDiff.path);
    if (!byDirectory.has(dir)) byDirectory.set(dir, []);
    byDirectory.get(dir)!.push(fileDiff);
  }

  // Create initial groups by directory
  let groupId = 0;
  for (const [dir, dirFiles] of byDirectory) {
    const group: ChangeGroup = {
      id: `group-${groupId++}`,
      title: inferGroupTitle(dir, dirFiles),
      files: dirFiles.map((f) => f.path),
      hunks: dirFiles.flatMap((f) =>
        f.hunks.map((h) => ({ file: f.path, hunk: h }))
      ),
      changeType: inferChangeType(dirFiles),
      symbolsIntroduced: extractNewSymbols(dirFiles),
      symbolsModified: extractModifiedSymbols(dirFiles),
    };
    groups.push(group);
  }

  return groups;
}

function getModulePath(filePath: string): string {
  const parts = filePath.split("/");
  // Return first 2 levels of directory, or just the file if at root
  if (parts.length <= 2) return parts[0];
  return parts.slice(0, 2).join("/");
}

function inferGroupTitle(dir: string, files: FileDiff[]): string {
  // Check for common patterns
  if (
    dir.includes("test") ||
    files.every((f) => f.path.includes(".test.") || f.path.includes(".spec."))
  ) {
    return `Tests: ${dir}`;
  }
  if (files.length === 1) {
    return files[0].path.split("/").pop() || dir;
  }
  return `Changes in ${dir}`;
}

function inferChangeType(files: FileDiff[]): ChangeGroup["changeType"] {
  const paths = files.map((f) => f.path.toLowerCase());

  if (paths.every((p) => p.includes("test") || p.includes("spec")))
    return "test";
  if (
    paths.every(
      (p) => p.includes("readme") || p.includes("doc") || p.endsWith(".md")
    )
  )
    return "docs";
  if (
    paths.every(
      (p) =>
        p.includes("config") ||
        p.endsWith(".json") ||
        p.endsWith(".yaml") ||
        p.endsWith(".yml") ||
        p.endsWith(".toml")
    )
  )
    return "config";

  // Check hunk content for patterns
  const allContent = files
    .flatMap((f) => f.hunks.map((h) => h.content))
    .join("\n");
  if (allContent.includes("fix") || allContent.includes("bug")) return "bugfix";

  return "unknown";
}

function extractNewSymbols(files: FileDiff[]): string[] {
  const symbols: string[] = [];

  for (const file of files) {
    for (const hunk of file.hunks) {
      const addedLines = hunk.content
        .split("\n")
        .filter((l) => l.startsWith("+"))
        .map((l) => l.slice(1));

      for (const line of addedLines) {
        // Function declarations
        const funcMatch = line.match(
          /(?:function|const|let|var)\s+(\w+)\s*[=(]/
        );
        if (funcMatch) symbols.push(funcMatch[1]);

        // Class declarations
        const classMatch = line.match(/class\s+(\w+)/);
        if (classMatch) symbols.push(classMatch[1]);

        // Type/interface declarations
        const typeMatch = line.match(/(?:type|interface)\s+(\w+)/);
        if (typeMatch) symbols.push(typeMatch[1]);

        // Python function/class
        const pyMatch = line.match(/(?:def|class)\s+(\w+)/);
        if (pyMatch) symbols.push(pyMatch[1]);
      }
    }
  }

  return [...new Set(symbols)];
}

function extractModifiedSymbols(files: FileDiff[]): string[] {
  const symbols: string[] = [];

  for (const file of files) {
    for (const hunk of file.hunks) {
      // The hunk header often contains the function name
      if (hunk.header) {
        const funcMatch = hunk.header.match(/(?:function|def|class)\s+(\w+)/);
        if (funcMatch) symbols.push(funcMatch[1]);
      }
    }
  }

  return [...new Set(symbols)];
}
