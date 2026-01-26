import { execSync } from "child_process";

export interface DiffTarget {
  type: "pr" | "local";
  prUrl?: string;
  base?: string;
  head?: string;
}

/**
 * Parse a target argument and determine if it's a PR URL or local git reference
 */
export function parseTarget(target: string): DiffTarget {
  // GitHub PR URL
  if (
    target.startsWith("https://github.com/") ||
    target.startsWith("http://github.com/") ||
    target.startsWith("github.com/") ||
    target.match(/^[\w-]+\/[\w-]+\/pull\/\d+$/) ||
    target.match(/^[\w-]+\/[\w-]+#\d+$/)
  ) {
    // Normalize short forms to full URL
    let prUrl = target;
    if (!target.startsWith("http")) {
      if (target.includes("#")) {
        // owner/repo#123 format
        const [repo, num] = target.split("#");
        prUrl = `https://github.com/${repo}/pull/${num}`;
      } else if (!target.startsWith("github.com/")) {
        // owner/repo/pull/123 format
        prUrl = `https://github.com/${target}`;
      } else {
        prUrl = `https://${target}`;
      }
    }
    return { type: "pr", prUrl };
  }

  // Diff range format: base...head or base..head
  if (target.includes("...") || target.includes("..")) {
    const separator = target.includes("...") ? "..." : "..";
    const [base, head] = target.split(separator);
    return { type: "local", base: base || getDefaultBranch(), head };
  }

  // Single reference: could be SHA, branch, or tag
  // Treat as head, compare against default branch
  if (isLikelyCommitHash(target) && !hasUncommittedChanges()) {
    return {
      type: "local",
      base: `${target}^`,
      head: target,
    };
  }
  return {
    type: "local",
    base: getDefaultBranch(),
    head: target,
  };
}

/**
 * Get the default branch (main or master) for the current repository
 */
export function getDefaultBranch(): string {
  try {
    // Try to get the remote HEAD reference
    const remoteHead = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    // refs/remotes/origin/main -> main
    return remoteHead.replace("refs/remotes/origin/", "");
  } catch {
    // Fallback: check if main exists, otherwise master
    try {
      execSync("git rev-parse --verify main", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      });
      return "main";
    } catch {
      try {
        execSync("git rev-parse --verify master", {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "ignore"],
        });
        return "master";
      } catch {
        // Last resort default
        return "main";
      }
    }
  }
}

/**
 * Validate that a git reference exists
 */
export function validateRef(ref: string): boolean {
  try {
    execSync(`git rev-parse --verify "${ref}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a ref to its full SHA
 */
export function resolveRef(ref: string): string {
  return execSync(`git rev-parse "${ref}"`, {
    encoding: "utf-8",
  }).trim();
}

/**
 * Check if we're in a git repository
 */
export function isGitRepository(): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current branch name
 */
export function getCurrentBranch(): string | null {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
    }).trim();
    return branch === "HEAD" ? null : branch;
  } catch {
    return null;
  }
}

/**
 * Check if there are uncommitted changes (staged or unstaged)
 */
export function hasUncommittedChanges(): boolean {
  try {
    // Check for any changes in working directory or staging area
    const status = execSync("git status --porcelain", {
      encoding: "utf-8",
    }).trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

/**
 * Check if two refs resolve to the same commit
 */
export function refsAreSame(ref1: string, ref2: string): boolean {
  try {
    const sha1 = execSync(`git rev-parse "${ref1}"`, {
      encoding: "utf-8",
    }).trim();
    const sha2 = execSync(`git rev-parse "${ref2}"`, {
      encoding: "utf-8",
    }).trim();
    return sha1 === sha2;
  } catch {
    return false;
  }
}

/**
 * Get a short hash representing the current working directory diff state
 * This can be used as part of a cache key to detect when uncommitted changes have changed
 */
export function getWorkingDirDiffHash(base: string): string {
  try {
    const diff = execSync(`git diff "${base}"`, {
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    });
    // Use a simple hash of the diff content
    let hash = 0;
    for (let i = 0; i < diff.length; i++) {
      const char = diff.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    // Return absolute value as hex, padded to 8 chars
    return Math.abs(hash).toString(16).padStart(8, "0");
  } catch {
    return "unknown";
  }
}

function isLikelyCommitHash(ref: string): boolean {
  if (!/^[0-9a-f]{7,40}$/i.test(ref)) {
    return false;
  }
  try {
    execSync(`git show-ref --verify --quiet "refs/heads/${ref}"`, {
      stdio: ["pipe", "pipe", "ignore"],
    });
    return false;
  } catch {
    // Not a branch
  }
  try {
    execSync(`git show-ref --verify --quiet "refs/tags/${ref}"`, {
      stdio: ["pipe", "pipe", "ignore"],
    });
    return false;
  } catch {
    // Not a tag
  }
  try {
    execSync(`git rev-parse --verify "${ref}^{commit}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}
