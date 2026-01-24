import { execSync } from 'child_process';

export interface PRFile {
  path: string;
  additions: number;
  deletions: number;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  previousPath?: string;
}

export interface PRData {
  url?: string;
  title?: string;
  body?: string;
  author?: string;
  baseBranch: string;
  headBranch: string;
  files: PRFile[];
  diff: string;
  createdAt?: Date;
}

interface CLIOptions {
  base?: string;
  head?: string;
}

/**
 * Fetch PR data from GitHub using the gh CLI, or generate from local branches
 */
export async function getPRData(prUrl: string | undefined, options: CLIOptions): Promise<PRData> {
  if (prUrl) {
    return fetchRemotePR(prUrl);
  } else if (options.head) {
    return fetchLocalDiff(options.base || 'main', options.head);
  }
  throw new Error('Must provide either a PR URL or --head branch');
}

async function fetchRemotePR(prUrl: string): Promise<PRData> {
  // Verify gh is available
  try {
    execSync('gh --version', { stdio: 'ignore' });
  } catch {
    throw new Error(
      'GitHub CLI (gh) not found. Install it from https://cli.github.com/\n' +
      'Then run: gh auth login'
    );
  }

  // Fetch PR metadata
  const metadataJson = execSync(
    `gh pr view "${prUrl}" --json title,body,author,files,baseRefName,headRefName,createdAt`,
    { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
  );
  const metadata = JSON.parse(metadataJson);

  // Fetch the diff
  const diff = execSync(`gh pr diff "${prUrl}"`, {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  });

  return {
    url: prUrl,
    title: metadata.title,
    body: metadata.body,
    author: metadata.author?.login,
    baseBranch: metadata.baseRefName,
    headBranch: metadata.headRefName,
    createdAt: metadata.createdAt ? new Date(metadata.createdAt) : undefined,
    files: metadata.files.map((f: any) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      status: mapFileStatus(f.status),
      previousPath: f.previousPath,
    })),
    diff,
  };
}

async function fetchLocalDiff(base: string, head: string): Promise<PRData> {
  // Get list of changed files
  const filesOutput = execSync(
    `git diff --name-status ${base}...${head}`,
    { encoding: 'utf-8' }
  );

  const files: PRFile[] = filesOutput
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [status, ...pathParts] = line.split('\t');
      const path = pathParts[pathParts.length - 1];
      const previousPath = pathParts.length > 1 ? pathParts[0] : undefined;

      // Get additions/deletions for this file
      let additions = 0;
      let deletions = 0;
      try {
        const stat = execSync(
          `git diff --numstat ${base}...${head} -- "${path}"`,
          { encoding: 'utf-8' }
        ).trim();
        if (stat) {
          const [add, del] = stat.split('\t');
          additions = parseInt(add) || 0;
          deletions = parseInt(del) || 0;
        }
      } catch {
        // Binary file or other issue
      }

      return {
        path,
        additions,
        deletions,
        status: mapGitStatus(status),
        previousPath,
      };
    });

  // Get the full diff
  const diff = execSync(`git diff ${base}...${head}`, {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  });

  return {
    baseBranch: base,
    headBranch: head,
    files,
    diff,
  };
}

function mapFileStatus(status: string): PRFile['status'] {
  switch (status?.toLowerCase()) {
    case 'added': return 'added';
    case 'removed': return 'removed';
    case 'renamed': return 'renamed';
    default: return 'modified';
  }
}

function mapGitStatus(status: string): PRFile['status'] {
  switch (status[0]) {
    case 'A': return 'added';
    case 'D': return 'removed';
    case 'R': return 'renamed';
    default: return 'modified';
  }
}
