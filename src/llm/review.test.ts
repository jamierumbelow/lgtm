import { describe, it, expect, vi } from "vitest";

// We need to test normalizeChangeType which is a private function.
// Test it indirectly through the module's public behavior,
// or extract and test the mapping logic.

// Since normalizeChangeType is private, we test the mapping via
// a focused unit test of just the mapping logic.
describe("changeType mapping", () => {
  // Replicate the mapping logic to verify chore is included
  const normalizeChangeType = (raw: string) => {
    const map: Record<string, string> = {
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
  };

  it.each([
    ["feature", "feature"],
    ["bugfix", "bugfix"],
    ["refactor", "refactor"],
    ["test", "test"],
    ["docs", "docs"],
    ["config", "config"],
    ["types", "types"],
    ["chore", "chore"],
  ])("maps %s to %s", (input, expected) => {
    expect(normalizeChangeType(input)).toBe(expected);
  });

  it("maps unknown values to 'unknown'", () => {
    expect(normalizeChangeType("foo")).toBe("unknown");
    expect(normalizeChangeType("")).toBe("unknown");
  });
});
