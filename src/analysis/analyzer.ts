import { PRData, PRFile } from '../github/pr.js';
import { aggregateContributors, FileContributor } from '../github/blame.js';
import { chunkDiff, ChangeGroup } from './chunker.js';
import { TraceMatch } from './trace-finder.js';

export interface ReviewQuestion {
  id: string;
  question: string;
  answer?: string;
  context?: string;
}

export interface Analysis {
  // Metadata
  prUrl?: string;
  title?: string;
  description?: string;
  author?: string;
  baseBranch: string;
  headBranch: string;
  analyzedAt: Date;

  // Stats
  filesChanged: number;
  additions: number;
  deletions: number;

  // Semantic breakdown
  changeGroups: ChangeGroup[];

  // Standard questions
  questions: ReviewQuestion[];

  // Who has context
  contributors: FileContributor[];
  suggestedReviewers: string[];

  // LLM traces (if found)
  traces?: TraceMatch[];
}

interface AnalyzeOptions {
  useLLM: boolean;
}

const STANDARD_QUESTIONS: Omit<ReviewQuestion, 'answer' | 'context'>[] = [
  {
    id: 'failure-modes',
    question: 'In what ways can this go wrong? Which of those are covered by the existing code?',
  },
  {
    id: 'input-domain',
    question: 'What is the domain of inputs to the code covered by the changes?',
  },
  {
    id: 'output-range',
    question: 'What is the range of outputs from the code covered by the changes?',
  },
  {
    id: 'external-deps',
    question: 'What external systems (external to this codebase) do these changes rely upon?',
  },
  {
    id: 'decomposition',
    question: 'Can this PR be broken down into smaller PRs?',
  },
  {
    id: 'new-symbols',
    question: 'What symbols (functions, classes, types, constants) does it introduce?',
  },
  {
    id: 'duplication',
    question: 'Does it introduce duplication?',
  },
  {
    id: 'abstractions',
    question: 'Do these abstractions make sense?',
  },
  {
    id: 'reviewers',
    question: 'Who worked on these files? Who else might have the context to provide feedback?',
  },
  {
    id: 'invariants',
    question: 'What invariants does this change or introduce?',
  },
  {
    id: 'error-handling',
    question: 'Are there error paths that aren\'t handled?',
  },
  {
    id: 'rollback',
    question: 'What\'s the rollback story if this breaks in production?',
  },
];

export async function analyzeChanges(prData: PRData, options: AnalyzeOptions): Promise<Analysis> {
  // Calculate stats
  const additions = prData.files.reduce((sum, f) => sum + f.additions, 0);
  const deletions = prData.files.reduce((sum, f) => sum + f.deletions, 0);

  // Chunk the diff into semantic groups
  const changeGroups = await chunkDiff(prData.diff, prData.files);

  // Get contributors
  const filePaths = prData.files.map(f => f.path);
  const contributors = await aggregateContributors(filePaths);

  // Suggest reviewers: top contributors who aren't the PR author
  const suggestedReviewers = contributors
    .filter(c => !prData.author || !c.email.includes(prData.author))
    .slice(0, 3)
    .map(c => c.name);

  // Build questions with context
  const questions: ReviewQuestion[] = STANDARD_QUESTIONS.map(q => ({
    ...q,
    answer: undefined, // Will be filled by LLM if enabled
    context: getQuestionContext(q.id, prData, changeGroups, contributors),
  }));

  // If LLM is enabled, we'd call out to generate descriptions and answers here
  // For now, we provide the structural analysis only
  if (options.useLLM) {
    // TODO: Call LLM to generate:
    // - Plain English descriptions for each changeGroup
    // - Answers to each question
    // This would use the describer module
  }

  return {
    prUrl: prData.url,
    title: prData.title,
    description: prData.body,
    author: prData.author,
    baseBranch: prData.baseBranch,
    headBranch: prData.headBranch,
    analyzedAt: new Date(),
    filesChanged: prData.files.length,
    additions,
    deletions,
    changeGroups,
    questions,
    contributors,
    suggestedReviewers,
  };
}

function getQuestionContext(
  questionId: string,
  prData: PRData,
  changeGroups: ChangeGroup[],
  contributors: FileContributor[]
): string {
  switch (questionId) {
    case 'reviewers':
      return contributors
        .slice(0, 5)
        .map(c => `${c.name} (${c.linesAuthored} lines, ${c.commits} commits)`)
        .join('\n');

    case 'new-symbols':
      return changeGroups
        .flatMap(g => g.symbolsIntroduced || [])
        .join(', ') || 'Analysis pending...';

    case 'decomposition':
      const filesByDir = new Map<string, string[]>();
      for (const file of prData.files) {
        const dir = file.path.split('/').slice(0, -1).join('/') || '.';
        if (!filesByDir.has(dir)) filesByDir.set(dir, []);
        filesByDir.get(dir)!.push(file.path);
      }
      return `Changes span ${filesByDir.size} directories:\n` +
        Array.from(filesByDir.entries())
          .map(([dir, files]) => `  ${dir}/ (${files.length} files)`)
          .join('\n');

    default:
      return '';
  }
}
