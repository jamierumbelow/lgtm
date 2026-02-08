import { PRFile } from "../github/pr.js";
import { createStableChangeGroupId } from "./change-id.js";

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

export interface SymbolInfo {
  name: string;
  signature: string; // Full declaration line, trimmed
  file: string;
  newLine: number; // Line number in the new file
}

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type SuggestionSeverity =
  | "nit"
  | "suggestion"
  | "important"
  | "critical";

export interface ReviewSuggestion {
  severity: SuggestionSeverity;
  text: string;
  file?: string;
}

export interface ChangeGroup {
  id: string;
  title: string;
  description?: string; // Filled by LLM
  files: string[];
  hunks: Array<{ file: string; hunk: DiffHunk }>;
  symbolsIntroduced?: string[];
  symbolsModified?: string[];
  symbolsIntroducedInfo?: SymbolInfo[];
  symbolsModifiedInfo?: SymbolInfo[];
  riskLevel?: RiskLevel;
  verdict?: string;
  suggestions?: ReviewSuggestion[];
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
 * Group diff hunks into logical change groups (heuristic only).
 * LLM-powered splitting + review is handled by the analyzer via review.ts.
 */
export async function chunkDiff(
  diff: string,
  files: PRFile[],
  _options: ChunkOptions = {}
): Promise<ChangeGroup[]> {
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
  for (const [dir, dirFiles] of byDirectory) {
    const groupHunks = dirFiles.flatMap((f) =>
      f.hunks.map((h) => ({ file: f.path, hunk: h }))
    );
    const groupFiles = dirFiles.map((f) => f.path);
    const symbolInfos = extractNewSymbolInfos(dirFiles);
    const modifiedInfos = extractModifiedSymbolInfos(dirFiles);
    const group: ChangeGroup = {
      id: createStableChangeGroupId({
        files: groupFiles,
        hunks: groupHunks,
      }),
      title: inferGroupTitle(dir, dirFiles),
      files: groupFiles,
      hunks: groupHunks,
      changeType: inferChangeType(dirFiles),
      symbolsIntroduced: [...new Set(symbolInfos.map((s) => s.name))],
      symbolsModified: [...new Set(modifiedInfos.map((s) => s.name))],
      symbolsIntroducedInfo: symbolInfos,
      symbolsModifiedInfo: modifiedInfos,
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

export function matchSymbolName(line: string): string | null {
  // Function declarations
  const funcMatch = line.match(/(?:function|const|let|var)\s+(\w+)\s*[=(]/);
  if (funcMatch) return funcMatch[1];

  // Class declarations
  const classMatch = line.match(/class\s+(\w+)/);
  if (classMatch) return classMatch[1];

  // Type/interface declarations
  const typeMatch = line.match(/(?:type|interface)\s+(\w+)/);
  if (typeMatch) return typeMatch[1];

  // Python function/class
  const pyMatch = line.match(/(?:def|class)\s+(\w+)/);
  if (pyMatch) return pyMatch[1];

  return null;
}

export function extractNewSymbolInfos(files: FileDiff[]): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    for (const hunk of file.hunks) {
      const lines = hunk.content.split("\n");
      let newLine = hunk.newStart;

      for (const line of lines) {
        if (!line) continue;
        const firstChar = line[0];

        if (firstChar === "+") {
          const content = line.slice(1);
          const name = matchSymbolName(content);
          if (name) {
            const key = `${file.path}:${name}`;
            if (!seen.has(key)) {
              seen.add(key);
              symbols.push({
                name,
                signature: content.trim(),
                file: file.path,
                newLine,
              });
            }
          }
          newLine++;
        } else if (firstChar === "-") {
          // deletions don't advance newLine
        } else {
          // context line
          newLine++;
        }
      }
    }
  }

  return symbols;
}

export function extractModifiedSymbolInfos(files: FileDiff[]): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    for (const hunk of file.hunks) {
      if (hunk.header) {
        const funcMatch = hunk.header.match(/(?:function|def|class)\s+(\w+)/);
        if (funcMatch) {
          const key = `${file.path}:${funcMatch[1]}`;
          if (!seen.has(key)) {
            seen.add(key);
            symbols.push({
              name: funcMatch[1],
              signature: hunk.header.trim(),
              file: file.path,
              newLine: hunk.newStart,
            });
          }
        }
      }
    }
  }

  return symbols;
}

export function extractNewSymbolInfosFromHunks(
  hunks: Array<{ file: string; hunk: DiffHunk }>
): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  const seen = new Set<string>();

  for (const { file, hunk } of hunks) {
    const lines = hunk.content.split("\n");
    let newLine = hunk.newStart;

    for (const line of lines) {
      if (!line) continue;
      const firstChar = line[0];

      if (firstChar === "+") {
        const content = line.slice(1);
        const name = matchSymbolName(content);
        if (name) {
          const key = `${file}:${name}`;
          if (!seen.has(key)) {
            seen.add(key);
            symbols.push({
              name,
              signature: content.trim(),
              file,
              newLine,
            });
          }
        }
        newLine++;
      } else if (firstChar === "-") {
        // deletions don't advance newLine
      } else {
        // context line
        newLine++;
      }
    }
  }

  return symbols;
}

export function extractModifiedSymbolInfosFromHunks(
  hunks: Array<{ file: string; hunk: DiffHunk }>
): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  const seen = new Set<string>();

  for (const { file, hunk } of hunks) {
    if (hunk.header) {
      const funcMatch = hunk.header.match(/(?:function|def|class)\s+(\w+)/);
      if (funcMatch) {
        const key = `${file}:${funcMatch[1]}`;
        if (!seen.has(key)) {
          seen.add(key);
          symbols.push({
            name: funcMatch[1],
            signature: hunk.header.trim(),
            file,
            newLine: hunk.newStart,
          });
        }
      }
    }
  }

  return symbols;
}
