import { describe, it, expect } from "vitest";
import { trimHunkContent } from "./diff-context.js";

describe("trimHunkContent", () => {
  it("returns content unchanged when all lines are changes", () => {
    const content = "+added1\n+added2\n-removed1";
    expect(trimHunkContent(content, 1)).toBe(content);
  });

  it("returns content unchanged when no changes exist", () => {
    const content = " context1\n context2\n context3";
    expect(trimHunkContent(content, 1)).toBe(content);
  });

  it("trims distant context lines, keeping N lines around changes", () => {
    const content = [
      " far-before",
      " context-before",
      "+added",
      " context-after",
      " far-after",
    ].join("\n");

    const result = trimHunkContent(content, 1);
    expect(result).toContain("context-before");
    expect(result).toContain("+added");
    expect(result).toContain("context-after");
    expect(result).not.toContain("far-before");
    expect(result).not.toContain("far-after");
  });

  it("merges adjacent context ranges", () => {
    const content = [
      " context",
      "+added1",
      " between",
      "+added2",
      " context",
    ].join("\n");

    // With contextLines=1, both changes and their context overlap
    const result = trimHunkContent(content, 1);
    // Should be one continuous block, no "..."
    expect(result).not.toContain("...");
  });

  it("inserts ... between disjoint ranges", () => {
    const content = [
      "+added1",
      " line2",
      " line3",
      " line4",
      " line5",
      " line6",
      "+added2",
    ].join("\n");

    const result = trimHunkContent(content, 1);
    expect(result).toContain("...");
  });

  it("handles contextLines=0", () => {
    const content = [
      " before",
      "+added",
      " after",
    ].join("\n");

    const result = trimHunkContent(content, 0);
    expect(result).toBe("+added");
  });
});
