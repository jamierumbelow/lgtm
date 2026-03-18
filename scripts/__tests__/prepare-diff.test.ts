import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { buildFormattedDiff, buildDiffOutput } from "../prepare-diff.ts";
import type { FileDiff } from "../../src/analysis/chunker.ts";

const SIMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@ function foo() {
 function foo() {
-  return 1;
+  return 2;
+  // changed
 }
diff --git a/bun.lock b/bun.lock
index 000..111 100644
--- a/bun.lock
+++ b/bun.lock
@@ -1,2 +1,2 @@
-old lock content
+new lock content
`;

describe("buildFormattedDiff", () => {
  const hunk = {
    oldStart: 1,
    oldLines: 3,
    newStart: 1,
    newLines: 4,
    header: "function foo() {",
    content: " function foo() {\n-  return 1;\n+  return 2;\n+  // changed\n }",
  };

  const fileDiffs: FileDiff[] = [
    { path: "src/foo.ts", status: "modified", hunks: [hunk] },
    { path: "src/bar.ts", status: "modified", hunks: [] },
  ];

  test("includes eligible files", () => {
    const result = buildFormattedDiff(fileDiffs, new Set());
    expect(result).toContain("=== src/foo.ts ===");
    expect(result).toContain("[Hunk 0]");
    expect(result).toContain("return 2");
  });

  test("skips excluded files", () => {
    const result = buildFormattedDiff(fileDiffs, new Set(["src/foo.ts"]));
    expect(result).not.toContain("=== src/foo.ts ===");
    expect(result).toContain("=== src/bar.ts ===");
  });

  test("numbers hunks per-file starting at 0", () => {
    const multiHunk: FileDiff[] = [
      {
        path: "src/multi.ts",
        status: "modified",
        hunks: [
          { ...hunk, newStart: 1 },
          { ...hunk, newStart: 50 },
          { ...hunk, newStart: 100 },
        ],
      },
    ];
    const result = buildFormattedDiff(multiHunk, new Set());
    expect(result).toContain("[Hunk 0]");
    expect(result).toContain("[Hunk 1]");
    expect(result).toContain("[Hunk 2]");
    expect(result).not.toContain("[Hunk 3]");
  });

  test("empty file list returns empty string", () => {
    expect(buildFormattedDiff([], new Set())).toBe("");
  });
});

describe("buildDiffOutput", () => {
  test("returns empty sentinel for blank diff", () => {
    const result = buildDiffOutput("");
    expect(result.empty).toBe(true);
    expect(result.fileDiffs).toEqual([]);
    expect(result.formattedDiff).toBe("");
    expect(result.meta).toBeNull();
  });

  test("returns empty sentinel for whitespace-only diff", () => {
    expect(buildDiffOutput("   \n  ").empty).toBe(true);
  });

  test("filters out lockfiles into meta.excludedFiles", () => {
    const result = buildDiffOutput(SIMPLE_DIFF);
    expect(result.empty).toBe(false);
    const meta = result.meta as { excludedFiles: string[] };
    expect(meta.excludedFiles).toContain("bun.lock");
    expect(result.fileDiffs.map((f) => f.path)).not.toContain("bun.lock");
  });

  test("eligible files are in fileDiffs", () => {
    const result = buildDiffOutput(SIMPLE_DIFF);
    expect(result.fileDiffs.map((f) => f.path)).toContain("src/foo.ts");
  });

  test("formattedDiff includes Files Changed header", () => {
    const result = buildDiffOutput(SIMPLE_DIFF);
    expect(result.formattedDiff).toContain("## Files Changed");
    expect(result.formattedDiff).toContain("## Unified Diff");
  });

  test("formattedDiff includes omitted files note when lockfile present", () => {
    const result = buildDiffOutput(SIMPLE_DIFF);
    expect(result.formattedDiff).toContain("## Diff Omitted");
    expect(result.formattedDiff).toContain("bun.lock");
  });

  test("formattedDiff has no omitted note when no lockfiles", () => {
    const noLockDiff = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,2 +1,2 @@
-old
+new
`;
    const result = buildDiffOutput(noLockDiff);
    expect(result.formattedDiff).not.toContain("## Diff Omitted");
  });
});
