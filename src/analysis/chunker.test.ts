import { describe, it, expect } from "vitest";
import {
  parseDiff,
  chunkDiffHeuristic,
  matchSymbolName,
  extractNewSymbolInfos,
  extractModifiedSymbolInfos,
} from "./chunker.js";

// --- parseDiff ---

describe("parseDiff", () => {
  it("returns empty array for empty diff", () => {
    expect(parseDiff("")).toEqual([]);
  });

  it("parses a single modified file with one hunk", () => {
    const diff = `diff --git a/src/foo.ts b/src/foo.ts
index abc123..def456 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@ function foo()
 line1
+added
 line2
 line3`;

    const result = parseDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("src/foo.ts");
    expect(result[0].status).toBe("modified");
    expect(result[0].previousPath).toBeUndefined();
    expect(result[0].hunks).toHaveLength(1);
    expect(result[0].hunks[0].oldStart).toBe(1);
    expect(result[0].hunks[0].oldLines).toBe(3);
    expect(result[0].hunks[0].newStart).toBe(1);
    expect(result[0].hunks[0].newLines).toBe(4);
    expect(result[0].hunks[0].header).toBe("function foo()");
    expect(result[0].hunks[0].content).toContain("+added");
  });

  it("parses an added file", () => {
    const diff = `diff --git a/new-file.ts b/new-file.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/new-file.ts
@@ -0,0 +1,3 @@
+line1
+line2
+line3`;

    const result = parseDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("new-file.ts");
    expect(result[0].status).toBe("added");
    expect(result[0].hunks).toHaveLength(1);
    expect(result[0].hunks[0].newStart).toBe(1);
    expect(result[0].hunks[0].newLines).toBe(3);
  });

  it("parses a deleted file", () => {
    const diff = `diff --git a/old-file.ts b/old-file.ts
deleted file mode 100644
index abc1234..0000000
--- a/old-file.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-line1
-line2`;

    const result = parseDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("old-file.ts");
    expect(result[0].status).toBe("removed");
  });

  it("parses a renamed file", () => {
    const diff = `diff --git a/old-name.ts b/new-name.ts
rename from old-name.ts
rename to new-name.ts
index abc123..def456 100644
--- a/old-name.ts
+++ b/new-name.ts
@@ -1,3 +1,3 @@
 line1
-old
+new
 line3`;

    const result = parseDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("new-name.ts");
    expect(result[0].previousPath).toBe("old-name.ts");
    expect(result[0].status).toBe("renamed");
  });

  it("parses multiple files", () => {
    const diff = `diff --git a/file1.ts b/file1.ts
index abc..def 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,2 +1,3 @@
 line1
+added1
 line2
diff --git a/file2.ts b/file2.ts
index ghi..jkl 100644
--- a/file2.ts
+++ b/file2.ts
@@ -1,2 +1,3 @@
 line1
+added2
 line2`;

    const result = parseDiff(diff);
    expect(result).toHaveLength(2);
    expect(result[0].path).toBe("file1.ts");
    expect(result[1].path).toBe("file2.ts");
  });

  it("parses multiple hunks in one file", () => {
    const diff = `diff --git a/file.ts b/file.ts
index abc..def 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@ function a()
 line1
+hunk1-added
 line2
 line3
@@ -10,3 +11,4 @@ function b()
 line10
+hunk2-added
 line11
 line12`;

    const result = parseDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0].hunks).toHaveLength(2);
    expect(result[0].hunks[0].header).toBe("function a()");
    expect(result[0].hunks[0].content).toContain("+hunk1-added");
    expect(result[0].hunks[1].header).toBe("function b()");
    expect(result[0].hunks[1].oldStart).toBe(10);
    expect(result[0].hunks[1].content).toContain("+hunk2-added");
  });

  it("handles hunk headers without line count (single line)", () => {
    const diff = `diff --git a/file.ts b/file.ts
index abc..def 100644
--- a/file.ts
+++ b/file.ts
@@ -1 +1,2 @@
 line1
+added`;

    const result = parseDiff(diff);
    expect(result[0].hunks[0].oldLines).toBe(1);
    expect(result[0].hunks[0].newLines).toBe(2);
  });

  it("ignores lines that are not part of hunk content", () => {
    const diff = `diff --git a/file.ts b/file.ts
index abc..def 100644
--- a/file.ts
+++ b/file.ts
Binary files differ`;

    const result = parseDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0].hunks).toHaveLength(0);
  });
});

// --- matchSymbolName ---

describe("matchSymbolName", () => {
  it("matches function declarations", () => {
    expect(matchSymbolName("function foo() {")).toBe("foo");
  });

  it("matches const arrow functions", () => {
    expect(matchSymbolName("const bar = () => {")).toBe("bar");
  });

  it("matches let/var declarations with assignment", () => {
    expect(matchSymbolName("let baz = (")).toBe("baz");
    expect(matchSymbolName("var qux = (")).toBe("qux");
  });

  it("matches class declarations", () => {
    expect(matchSymbolName("class MyClass {")).toBe("MyClass");
  });

  it("matches TypeScript type and interface", () => {
    expect(matchSymbolName("type Foo = {")).toBe("Foo");
    expect(matchSymbolName("interface Bar {")).toBe("Bar");
  });

  it("matches Python def and class", () => {
    expect(matchSymbolName("def my_func():")).toBe("my_func");
    expect(matchSymbolName("class MyPyClass:")).toBe("MyPyClass");
  });

  it("returns null for non-matching lines", () => {
    expect(matchSymbolName("  return 42;")).toBeNull();
    expect(matchSymbolName("// comment")).toBeNull();
    expect(matchSymbolName("")).toBeNull();
  });
});

// --- extractNewSymbolInfos ---

describe("extractNewSymbolInfos", () => {
  it("extracts symbols from added lines", () => {
    const files = [
      {
        path: "src/foo.ts",
        status: "added" as const,
        hunks: [
          {
            oldStart: 0,
            oldLines: 0,
            newStart: 1,
            newLines: 3,
            header: "",
            content: "+function hello() {\n+  return 1;\n+}",
          },
        ],
      },
    ];

    const result = extractNewSymbolInfos(files);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("hello");
    expect(result[0].file).toBe("src/foo.ts");
    expect(result[0].newLine).toBe(1);
    expect(result[0].signature).toBe("function hello() {");
  });

  it("does not extract symbols from context or removed lines", () => {
    const files = [
      {
        path: "src/foo.ts",
        status: "modified" as const,
        hunks: [
          {
            oldStart: 1,
            oldLines: 3,
            newStart: 1,
            newLines: 3,
            header: "",
            content: " function existing() {\n-function removed() {\n+  return 2;",
          },
        ],
      },
    ];

    const result = extractNewSymbolInfos(files);
    expect(result).toHaveLength(0);
  });

  it("deduplicates symbols by file:name", () => {
    const files = [
      {
        path: "src/foo.ts",
        status: "modified" as const,
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 2,
            header: "",
            content: "+function dup() {\n+function dup() {",
          },
        ],
      },
    ];

    const result = extractNewSymbolInfos(files);
    expect(result).toHaveLength(1);
  });
});

// --- extractModifiedSymbolInfos ---

describe("extractModifiedSymbolInfos", () => {
  it("extracts symbols from hunk headers", () => {
    const files = [
      {
        path: "src/bar.ts",
        status: "modified" as const,
        hunks: [
          {
            oldStart: 10,
            oldLines: 3,
            newStart: 10,
            newLines: 4,
            header: "function modifiedFunc()",
            content: " line\n+added\n line",
          },
        ],
      },
    ];

    const result = extractModifiedSymbolInfos(files);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("modifiedFunc");
    expect(result[0].file).toBe("src/bar.ts");
  });

  it("returns empty for hunks without function headers", () => {
    const files = [
      {
        path: "src/bar.ts",
        status: "modified" as const,
        hunks: [
          {
            oldStart: 1,
            oldLines: 2,
            newStart: 1,
            newLines: 3,
            header: "",
            content: " line\n+added",
          },
        ],
      },
    ];

    const result = extractModifiedSymbolInfos(files);
    expect(result).toHaveLength(0);
  });
});

// --- chunkDiffHeuristic ---

describe("chunkDiffHeuristic", () => {
  it("groups files by directory", () => {
    const diff = `diff --git a/src/auth/login.ts b/src/auth/login.ts
index abc..def 100644
--- a/src/auth/login.ts
+++ b/src/auth/login.ts
@@ -1,2 +1,3 @@
 line1
+added
 line2
diff --git a/src/auth/logout.ts b/src/auth/logout.ts
index abc..def 100644
--- a/src/auth/logout.ts
+++ b/src/auth/logout.ts
@@ -1,2 +1,3 @@
 line1
+added
 line2
diff --git a/src/payments/charge.ts b/src/payments/charge.ts
index abc..def 100644
--- a/src/payments/charge.ts
+++ b/src/payments/charge.ts
@@ -1,2 +1,3 @@
 line1
+added
 line2`;

    const groups = chunkDiffHeuristic(diff);
    expect(groups).toHaveLength(2);

    const authGroup = groups.find((g) => g.files.includes("src/auth/login.ts"));
    expect(authGroup).toBeDefined();
    expect(authGroup!.files).toContain("src/auth/logout.ts");

    const paymentGroup = groups.find((g) =>
      g.files.includes("src/payments/charge.ts")
    );
    expect(paymentGroup).toBeDefined();
  });

  it("infers test change type", () => {
    const diff = `diff --git a/src/auth/login.test.ts b/src/auth/login.test.ts
index abc..def 100644
--- a/src/auth/login.test.ts
+++ b/src/auth/login.test.ts
@@ -1,2 +1,3 @@
 line1
+added
 line2`;

    const groups = chunkDiffHeuristic(diff);
    expect(groups[0].changeType).toBe("test");
  });

  it("infers docs change type", () => {
    const diff = `diff --git a/docs/README.md b/docs/README.md
index abc..def 100644
--- a/docs/README.md
+++ b/docs/README.md
@@ -1,2 +1,3 @@
 line1
+added
 line2`;

    const groups = chunkDiffHeuristic(diff);
    expect(groups[0].changeType).toBe("docs");
  });

  it("infers config change type for json/yaml", () => {
    const diff = `diff --git a/tsconfig.json b/tsconfig.json
index abc..def 100644
--- a/tsconfig.json
+++ b/tsconfig.json
@@ -1,2 +1,3 @@
 line1
+added
 line2`;

    const groups = chunkDiffHeuristic(diff);
    expect(groups[0].changeType).toBe("config");
  });

  it("returns empty for empty diff", () => {
    expect(chunkDiffHeuristic("")).toEqual([]);
  });
});
