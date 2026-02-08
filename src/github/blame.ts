import { execSync } from "child_process";

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
 * Get contributors who have worked on a file and might have context.
 * Uses only local git operations (no network calls).
 */
export async function getFileContributors(
  filePath: string
): Promise<BlameInfo> {
  const contributors = new Map<string, FileContributor>();

  try {
    const blameOutput = execSync(
      `git blame --line-porcelain "${filePath}" 2>/dev/null | grep -E "^(author |author-mail |author-time )"`,
      { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
    );

    const lines = blameOutput.trim().split("\n");
    let currentAuthor: Partial<FileContributor> = {};

    for (const line of lines) {
      if (line.startsWith("author ")) {
        currentAuthor.name = line.slice(7);
      } else if (line.startsWith("author-mail ")) {
        currentAuthor.email = line.slice(12).replace(/[<>]/g, "");
      } else if (line.startsWith("author-time ")) {
        const timestamp = parseInt(line.slice(12)) * 1000;
        currentAuthor.lastCommitDate = new Date(timestamp);

        if (currentAuthor.email) {
          const existing = contributors.get(currentAuthor.email);
          if (existing) {
            existing.linesAuthored++;
            if (currentAuthor.lastCommitDate > existing.lastCommitDate) {
              existing.lastCommitDate = currentAuthor.lastCommitDate;
            }
          } else {
            contributors.set(currentAuthor.email, {
              email: currentAuthor.email,
              name: currentAuthor.name || "Unknown",
              commits: 0,
              linesAuthored: 1,
              lastCommitDate: currentAuthor.lastCommitDate,
            });
          }
        }
        currentAuthor = {};
      }
    }

    // Get commit counts per author — single git log call
    const logOutput = execSync(
      `git log --format="%ae" -- "${filePath}" 2>/dev/null`,
      { encoding: "utf-8" }
    );

    for (const email of logOutput.trim().split("\n").filter(Boolean)) {
      const contributor = contributors.get(email);
      if (contributor) {
        contributor.commits++;
      }
    }
  } catch {
    // File might be new or git command failed
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
