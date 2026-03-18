import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync } from "child_process";
import { getPRData } from "./pr.js";

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

/**
 * Helper: set up execSync to respond to specific git commands.
 * Commands not matched will throw (simulating git failure).
 */
function mockGitCommands(handlers: Record<string, string>) {
  mockExecSync.mockImplementation((cmd: string, _opts?: any) => {
    const command = String(cmd);
    for (const [pattern, result] of Object.entries(handlers)) {
      if (command.includes(pattern)) return result;
    }
    throw new Error(`Command failed: ${command}`);
  });
}

describe("getPRData - local diff", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("uses three-dot syntax when merge-base can be computed", async () => {
    mockGitCommands({
      "rev-parse --is-inside-work-tree": "true",
      'rev-parse --verify "abc123"': "abc123full",
      'rev-parse --verify "def456"': "def456full",
      'rev-parse "abc123"': "abc123full",
      'rev-parse "def456"': "def456full",
      'merge-base "abc123" "def456"': "commonancestor",
      "diff --name-status abc123...def456": "",
      "diff --numstat abc123...def456": "",
      "diff abc123...def456": "",
    });

    const result = await getPRData("abc123...def456", {});
    expect(result.baseBranch).toBe("abc123");
    expect(result.headBranch).toBe("def456");

    // Verify three-dot syntax was used
    const diffCalls = mockExecSync.mock.calls
      .map((c) => String(c[0]))
      .filter((c) => c.startsWith("git diff --name-status"));
    expect(diffCalls[0]).toContain("...");
  });

  it("falls back to two-dot syntax when merge-base cannot be computed", async () => {
    const handlers: Record<string, string> = {
      "rev-parse --is-inside-work-tree": "true",
      'rev-parse --verify "abc123"': "abc123full",
      'rev-parse --verify "def456"': "def456full",
      'rev-parse "abc123"': "abc123full",
      'rev-parse "def456"': "def456full",
      "diff --name-status abc123..def456": "",
      "diff --numstat abc123..def456": "",
      "diff abc123..def456": "",
    };

    mockExecSync.mockImplementation((cmd: string, _opts?: any) => {
      const command = String(cmd);
      // merge-base should fail
      if (command.includes("merge-base")) {
        throw new Error("fatal: No merge base found");
      }
      for (const [pattern, result] of Object.entries(handlers)) {
        if (command.includes(pattern)) return result;
      }
      throw new Error(`Command failed: ${command}`);
    });

    const result = await getPRData("abc123...def456", {});
    expect(result.baseBranch).toBe("abc123");
    expect(result.headBranch).toBe("def456");

    // Verify two-dot syntax was used (not three-dot)
    const diffCalls = mockExecSync.mock.calls
      .map((c) => String(c[0]))
      .filter((c) => c.startsWith("git diff --name-status"));
    expect(diffCalls[0]).toContain("..");
    expect(diffCalls[0]).not.toContain("...");
  });

  it("returns files with correct status and stats", async () => {
    mockGitCommands({
      "rev-parse --is-inside-work-tree": "true",
      'rev-parse --verify "abc123"': "abc123full",
      'rev-parse --verify "def456"': "def456full",
      'rev-parse "abc123"': "abc123full",
      'rev-parse "def456"': "def456full",
      'merge-base "abc123" "def456"': "commonancestor",
      "diff --name-status abc123...def456": "M\tsrc/foo.ts\nA\tsrc/bar.ts\nD\tsrc/baz.ts\n",
      "diff --numstat abc123...def456": "10\t2\tsrc/foo.ts\n15\t0\tsrc/bar.ts\n0\t8\tsrc/baz.ts\n",
      "diff abc123...def456": "diff content here",
    });

    const result = await getPRData("abc123...def456", {});
    expect(result.files).toHaveLength(3);
    expect(result.files[0]).toEqual({
      path: "src/foo.ts",
      additions: 10,
      deletions: 2,
      status: "modified",
      previousPath: undefined,
    });
    expect(result.files[1]).toEqual({
      path: "src/bar.ts",
      additions: 15,
      deletions: 0,
      status: "added",
      previousPath: undefined,
    });
    expect(result.files[2]).toEqual({
      path: "src/baz.ts",
      additions: 0,
      deletions: 8,
      status: "removed",
      previousPath: undefined,
    });
    expect(result.diff).toBe("diff content here");
  });

  it("returns empty diff when base and head resolve to same commit", async () => {
    mockGitCommands({
      "rev-parse --is-inside-work-tree": "true",
      'rev-parse --verify "abc123"': "sameSHA",
      'rev-parse --verify "def456"': "sameSHA",
      'rev-parse "abc123"': "sameSHA",
      'rev-parse "def456"': "sameSHA",
      "status --porcelain": "",
    });

    const result = await getPRData("abc123...def456", {});
    expect(result.files).toHaveLength(0);
    expect(result.diff).toBe("");
  });

  it("throws when base ref does not exist", async () => {
    mockExecSync.mockImplementation((cmd: string, _opts?: any) => {
      const command = String(cmd);
      if (command.includes("rev-parse --is-inside-work-tree")) return "true";
      if (command.includes('rev-parse --verify "badref"'))
        throw new Error("fatal: Needed a single revision");
      if (command.includes('rev-parse --verify "def456"')) return "def456full";
      throw new Error(`Command failed: ${command}`);
    });

    await expect(getPRData("badref...def456", {})).rejects.toThrow(
      'Base reference "badref" not found'
    );
  });

  it("throws when head ref does not exist", async () => {
    mockExecSync.mockImplementation((cmd: string, _opts?: any) => {
      const command = String(cmd);
      if (command.includes("rev-parse --is-inside-work-tree")) return "true";
      if (command.includes('rev-parse --verify "abc123"')) return "abc123full";
      if (command.includes('rev-parse --verify "badref"'))
        throw new Error("fatal: Needed a single revision");
      throw new Error(`Command failed: ${command}`);
    });

    await expect(getPRData("abc123...badref", {})).rejects.toThrow(
      'Head reference "badref" not found'
    );
  });
});
