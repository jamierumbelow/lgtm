import { execSync } from 'child_process';

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
  frequentReviewers: string[];
}

/**
 * Get contributors who have worked on a file and might have context
 */
export async function getFileContributors(filePath: string): Promise<BlameInfo> {
  const contributors = new Map<string, FileContributor>();

  try {
    // Get blame info with author details
    const blameOutput = execSync(
      `git blame --line-porcelain "${filePath}" 2>/dev/null | grep -E "^(author |author-mail |author-time )"`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );

    const lines = blameOutput.trim().split('\n');
    let currentAuthor: Partial<FileContributor> = {};

    for (const line of lines) {
      if (line.startsWith('author ')) {
        currentAuthor.name = line.slice(7);
      } else if (line.startsWith('author-mail ')) {
        currentAuthor.email = line.slice(12).replace(/[<>]/g, '');
      } else if (line.startsWith('author-time ')) {
        const timestamp = parseInt(line.slice(12)) * 1000;
        currentAuthor.lastCommitDate = new Date(timestamp);

        // Commit this author's line
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
              name: currentAuthor.name || 'Unknown',
              commits: 0, // We'll count these separately
              linesAuthored: 1,
              lastCommitDate: currentAuthor.lastCommitDate,
            });
          }
        }
        currentAuthor = {};
      }
    }

    // Get commit counts per author
    const logOutput = execSync(
      `git log --format="%ae" -- "${filePath}" 2>/dev/null`,
      { encoding: 'utf-8' }
    );

    for (const email of logOutput.trim().split('\n').filter(Boolean)) {
      const contributor = contributors.get(email);
      if (contributor) {
        contributor.commits++;
      }
    }
  } catch {
    // File might be new or git command failed
  }

  // Get frequent reviewers from PR history (if available via gh)
  const frequentReviewers = await getFrequentReviewers(filePath);

  return {
    path: filePath,
    contributors: Array.from(contributors.values())
      .sort((a, b) => b.linesAuthored - a.linesAuthored),
    frequentReviewers,
  };
}

async function getFrequentReviewers(filePath: string): Promise<string[]> {
  try {
    // This requires being in a GitHub repo with gh CLI
    const prsJson = execSync(
      `gh pr list --state merged --search "${filePath}" --json reviews --limit 20 2>/dev/null`,
      { encoding: 'utf-8' }
    );

    const prs = JSON.parse(prsJson);
    const reviewerCounts = new Map<string, number>();

    for (const pr of prs) {
      for (const review of pr.reviews || []) {
        const reviewer = review.author?.login;
        if (reviewer) {
          reviewerCounts.set(reviewer, (reviewerCounts.get(reviewer) || 0) + 1);
        }
      }
    }

    return Array.from(reviewerCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([login]) => login);
  } catch {
    return [];
  }
}

/**
 * Aggregate contributors across multiple files
 */
export async function aggregateContributors(filePaths: string[]): Promise<FileContributor[]> {
  const allContributors = new Map<string, FileContributor>();

  for (const path of filePaths) {
    const blameInfo = await getFileContributors(path);
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

  return Array.from(allContributors.values())
    .sort((a, b) => b.linesAuthored - a.linesAuthored);
}
