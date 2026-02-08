import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface FileContributor {
  email: string;
  name: string;
  commits: number;
  linesAuthored: number;
  lastCommitDate: Date;
}

export interface BlameInfo {
  path: string;
  contributors: FileContributor[];
}

/**
 * Spawn a git command and return its stdout, or null on failure.
 * Uses Bun.spawn when available (native, no shell overhead);
 * falls back to Node execFile (also no shell, but slower to spawn).
 */
async function spawnGit(args: string[]): Promise<string | null> {
  try {
    if (typeof Bun !== "undefined") {
      const proc = Bun.spawn(["git", ...args], {
        stdout: "pipe",
        stderr: "ignore",
      });
      const text = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      return exitCode === 0 ? text : null;
    }
    const { stdout } = await execFileAsync("git", args, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Get contributors who have worked on a file and might have context.
 * Uses only local git operations (no network calls).
 * Blame + log run in parallel per file, and all files run concurrently
 * without blocking the event loop (so LLM streaming isn't stalled).
 */
export async function getFileContributors(
  filePath: string
): Promise<BlameInfo> {
  const contributors = new Map<string, FileContributor>();

  // Spawn blame and log in parallel — no shell, no grep subprocess.
  // We filter the porcelain output in JS instead.
  const [blameOutput, logOutput] = await Promise.all([
    spawnGit(["blame", "--line-porcelain", filePath]),
    spawnGit(["log", "--format=%ae", "--", filePath]),
  ]);

  if (blameOutput) {
    let currentName: string | undefined;
    let currentEmail: string | undefined;

    for (const line of blameOutput.split("\n")) {
      if (line.startsWith("author ")) {
        currentName = line.slice(7);
      } else if (line.startsWith("author-mail ")) {
        currentEmail = line.slice(12).replace(/[<>]/g, "");
      } else if (line.startsWith("author-time ") && currentEmail) {
        const timestamp = parseInt(line.slice(12)) * 1000;
        const lastCommitDate = new Date(timestamp);

        const existing = contributors.get(currentEmail);
        if (existing) {
          existing.linesAuthored++;
          if (lastCommitDate > existing.lastCommitDate) {
            existing.lastCommitDate = lastCommitDate;
          }
        } else {
          contributors.set(currentEmail, {
            email: currentEmail,
            name: currentName || "Unknown",
            commits: 0,
            linesAuthored: 1,
            lastCommitDate,
          });
        }
        currentName = undefined;
        currentEmail = undefined;
      }
    }
  }

  if (logOutput) {
    for (const email of logOutput.trim().split("\n").filter(Boolean)) {
      const contributor = contributors.get(email);
      if (contributor) contributor.commits++;
    }
  }

  return {
    path: filePath,
    contributors: Array.from(contributors.values()).sort(
      (a, b) => b.linesAuthored - a.linesAuthored
    ),
  };
}

/**
 * Aggregate contributors across multiple files.
 * Runs all blame operations in parallel for speed.
 */
export async function aggregateContributors(
  filePaths: string[]
): Promise<FileContributor[]> {
  const allContributors = new Map<string, FileContributor>();

  // Run all blame operations in parallel instead of sequentially
  const blameInfos = await Promise.all(
    filePaths.map((path) => getFileContributors(path))
  );

  for (const blameInfo of blameInfos) {
    for (const contributor of blameInfo.contributors) {
      const existing = allContributors.get(contributor.email);
      if (existing) {
        existing.linesAuthored += contributor.linesAuthored;
        existing.commits += contributor.commits;
        if (contributor.lastCommitDate > existing.lastCommitDate) {
          existing.lastCommitDate = contributor.lastCommitDate;
        }
      } else {
        allContributors.set(contributor.email, { ...contributor });
      }
    }
  }

  return Array.from(allContributors.values()).sort(
    (a, b) => b.linesAuthored - a.linesAuthored
  );
}
