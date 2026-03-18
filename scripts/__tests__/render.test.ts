import { describe, test, expect } from "bun:test";
import {
  buildHunkLookup,
  mapChangeset,
  buildExcludedGroup,
  buildAnalysis,
  renderEmptyPage,
  type RawChangeset,
  type DiffData,
  type AnalysisData,
} from "../render.ts";
import type { FileDiff, DiffHunk } from "../../src/analysis/chunker.ts";

const makeHunk = (overrides: Partial<DiffHunk> = {}): DiffHunk => ({
  oldStart: 1,
  oldLines: 2,
  newStart: 1,
  newLines: 3,
  header: "function test()",
  content: "-old\n+new",
  ...overrides,
});

const makeFileDiff = (path: string, hunkCount = 1): FileDiff => ({
  path,
  status: "modified",
  hunks: Array.from({ length: hunkCount }, (_, i) =>
    makeHunk({ newStart: i * 10 + 1 })
  ),
});

describe("buildHunkLookup", () => {
  test("keys are filepath:hunkIndex (0-based)", () => {
    const files = [makeFileDiff("src/foo.ts", 3)];
    const lookup = buildHunkLookup(files);
    expect(lookup.has("src/foo.ts:0")).toBe(true);
    expect(lookup.has("src/foo.ts:1")).toBe(true);
    expect(lookup.has("src/foo.ts:2")).toBe(true);
    expect(lookup.has("src/foo.ts:3")).toBe(false);
  });

  test("multiple files get separate keys", () => {
    const files = [makeFileDiff("a.ts", 1), makeFileDiff("b.ts", 2)];
    const lookup = buildHunkLookup(files);
    expect(lookup.has("a.ts:0")).toBe(true);
    expect(lookup.has("b.ts:0")).toBe(true);
    expect(lookup.has("b.ts:1")).toBe(true);
  });

  test("lookup entry contains file and hunk", () => {
    const hunk = makeHunk({ newStart: 42 });
    const files: FileDiff[] = [{ path: "src/x.ts", status: "modified", hunks: [hunk] }];
    const entry = buildHunkLookup(files).get("src/x.ts:0");
    expect(entry?.file).toBe("src/x.ts");
    expect(entry?.hunk.newStart).toBe(42);
  });
});

describe("mapChangeset", () => {
  const files = [makeFileDiff("src/foo.ts", 2), makeFileDiff("src/bar.ts", 1)];
  const lookup = buildHunkLookup(files);

  const baseCs: RawChangeset = {
    id: "cs-1",
    title: "Test change",
    description: "A test",
    changeType: "feature",
    files: ["src/foo.ts"],
    hunkRefs: ["src/foo.ts:0", "src/foo.ts:1"],
    riskLevel: "low",
    verdict: "Looks good.",
    suggestions: [],
  };

  test("resolves hunkRefs to hunks from lookup", () => {
    const group = mapChangeset(baseCs, lookup);
    expect(group.hunks).toHaveLength(2);
    expect(group.hunks[0].file).toBe("src/foo.ts");
  });

  test("silently skips unknown hunkRefs", () => {
    const cs = { ...baseCs, hunkRefs: ["src/foo.ts:0", "nonexistent.ts:99"] };
    const group = mapChangeset(cs, lookup);
    expect(group.hunks).toHaveLength(1);
  });

  test("normalizes unknown changeType to 'unknown'", () => {
    const cs = { ...baseCs, changeType: "garbage" };
    const group = mapChangeset(cs, lookup);
    expect(group.changeType).toBe("unknown");
  });

  test("normalizes unknown riskLevel to 'medium'", () => {
    const cs = { ...baseCs, riskLevel: "extreme" };
    const group = mapChangeset(cs, lookup);
    expect(group.riskLevel).toBe("medium");
  });

  test("maps suggestions correctly", () => {
    const cs = {
      ...baseCs,
      suggestions: [
        { severity: "nit", text: "rename this", file: "src/foo.ts" },
        { severity: "critical", text: "SQL injection" },
      ],
    };
    const group = mapChangeset(cs, lookup);
    expect(group.suggestions).toHaveLength(2);
    expect(group.suggestions![0].severity).toBe("nit");
    expect(group.suggestions![1].severity).toBe("critical");
  });

  test("sets suggestions to undefined when empty", () => {
    const group = mapChangeset({ ...baseCs, suggestions: [] }, lookup);
    expect(group.suggestions).toBeUndefined();
  });

  test("generates stable id", () => {
    const g1 = mapChangeset(baseCs, lookup);
    const g2 = mapChangeset(baseCs, lookup);
    expect(g1.id).toBe(g2.id);
  });
});

describe("buildExcludedGroup", () => {
  test("changeType is config when all lockfiles", () => {
    const group = buildExcludedGroup(["bun.lock", "package-lock.json"]);
    expect(group.changeType).toBe("config");
  });

  test("changeType is unknown when mixed", () => {
    const group = buildExcludedGroup(["bun.lock", "dist/bundle.js"]);
    expect(group.changeType).toBe("unknown");
  });

  test("title is Generated/lockfiles", () => {
    const group = buildExcludedGroup(["bun.lock"]);
    expect(group.title).toBe("Generated/lockfiles");
  });

  test("hunks is empty array", () => {
    const group = buildExcludedGroup(["yarn.lock"]);
    expect(group.hunks).toEqual([]);
  });
});

describe("buildAnalysis", () => {
  const fileDiffs = [makeFileDiff("src/main.ts", 2)];
  const meta = {
    baseBranch: "main",
    headBranch: "feature/test",
    filesChanged: 1,
    additions: 10,
    deletions: 5,
    excludedFiles: [],
  };

  const diffData: DiffData = { empty: false, meta, fileDiffs };
  const analysisData: AnalysisData = {
    changesets: [
      {
        id: "cs-1",
        title: "Test",
        changeType: "feature",
        files: ["src/main.ts"],
        hunkRefs: ["src/main.ts:0"],
        riskLevel: "low",
        verdict: "Good.",
      },
    ],
    summary: "A test summary.",
    reviewGuidance: "Focus on changeset 1.",
  };

  test("builds Analysis with correct branch info", () => {
    const analysis = buildAnalysis(diffData, analysisData);
    expect(analysis.baseBranch).toBe("main");
    expect(analysis.headBranch).toBe("feature/test");
  });

  test("builds Analysis with correct stats", () => {
    const analysis = buildAnalysis(diffData, analysisData);
    expect(analysis.additions).toBe(10);
    expect(analysis.deletions).toBe(5);
    expect(analysis.filesChanged).toBe(1);
  });

  test("includes summary and reviewGuidance", () => {
    const analysis = buildAnalysis(diffData, analysisData);
    expect(analysis.summary).toBe("A test summary.");
    expect(analysis.reviewGuidance).toBe("Focus on changeset 1.");
  });

  test("maps changesets to changeGroups", () => {
    const analysis = buildAnalysis(diffData, analysisData);
    expect(analysis.changeGroups).toHaveLength(1);
    expect(analysis.changeGroups[0].title).toBe("Test");
  });

  test("appends excluded files group when excludedFiles is non-empty", () => {
    const data: DiffData = {
      ...diffData,
      meta: { ...meta, excludedFiles: ["bun.lock"] },
    };
    const analysis = buildAnalysis(data, analysisData);
    expect(analysis.changeGroups).toHaveLength(2);
    expect(analysis.changeGroups[1].title).toBe("Generated/lockfiles");
  });

  test("throws when meta is null", () => {
    expect(() =>
      buildAnalysis({ empty: true, meta: null, fileDiffs: [] }, analysisData)
    ).toThrow();
  });
});

describe("renderEmptyPage", () => {
  test("returns valid HTML with dark background", () => {
    const html = renderEmptyPage();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Nothing to Review");
    expect(html).toContain("#0d1117");
  });
});
