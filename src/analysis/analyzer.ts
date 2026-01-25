import { PRData, PRFile } from "../github/pr.js";
import { aggregateContributors, FileContributor } from "../github/blame.js";
import { chunkDiff, ChangeGroup } from "./chunker.js";
import { TraceMatch } from "./trace-finder.js";

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

  // Generation metadata
  generationTimeMs?: number;
  tokenCount?: number;
  costUsd?: number;
}

interface AnalyzeOptions {
  useLLM: boolean;
  includeTraces?: boolean;
}

export interface AnalysisShape {
  version: number;
  requiredQuestionIds: string[];
  requireTraces: boolean;
}

export interface AnalysisCoverage {
  needsChangeGroups: boolean;
  needsContributors: boolean;
  needsSuggestedReviewers: boolean;
  needsQuestions: boolean;
  missingQuestionIds: string[];
  needsTraces: boolean;
}

export interface AnalysisUpdateResult {
  analysis: Analysis;
  updated: boolean;
  missing: AnalysisCoverage;
}

export const ANALYSIS_SHAPE_VERSION = 1;

const STANDARD_QUESTIONS: Omit<ReviewQuestion, "answer" | "context">[] = [
  {
    id: "failure-modes",
    question:
      "In what ways can this go wrong? Which of those are covered by the existing code?",
  },
  {
    id: "input-domain",
    question:
      "What is the domain of inputs to the code covered by the changes?",
  },
  {
    id: "output-range",
    question:
      "What is the range of outputs from the code covered by the changes?",
  },
  {
    id: "external-deps",
    question:
      "What external systems (external to this codebase) do these changes rely upon?",
  },
  {
    id: "decomposition",
    question: "Can this PR be broken down into smaller PRs?",
  },
  {
    id: "new-symbols",
    question:
      "What symbols (functions, classes, types, constants) does it introduce?",
  },
  {
    id: "duplication",
    question: "Does it introduce duplication?",
  },
  {
    id: "abstractions",
    question: "Do these abstractions make sense?",
  },
  {
    id: "reviewers",
    question:
      "Who worked on these files? Who else might have the context to provide feedback?",
  },
  {
    id: "invariants",
    question: "What invariants does this change or introduce?",
  },
  {
    id: "error-handling",
    question: "Are there error paths that aren't handled?",
  },
  {
    id: "rollback",
    question: "What's the rollback story if this breaks in production?",
  },
];

export function getAnalysisShape(
  options: Pick<AnalyzeOptions, "includeTraces"> = {}
): AnalysisShape {
  return {
    version: ANALYSIS_SHAPE_VERSION,
    requiredQuestionIds: STANDARD_QUESTIONS.map((question) => question.id),
    requireTraces: options.includeTraces ?? false,
  };
}

export function getMissingAnalysisParts(
  analysis: Analysis | undefined,
  shape: AnalysisShape
): AnalysisCoverage {
  const existingQuestions = analysis?.questions ?? [];
  const existingQuestionIds = new Set(
    existingQuestions.map((question) => question.id)
  );
  const missingQuestionIds = shape.requiredQuestionIds.filter(
    (id) => !existingQuestionIds.has(id)
  );

  const needsChangeGroups = !analysis?.changeGroups;
  const needsContributors = !analysis?.contributors;
  const needsSuggestedReviewers = !analysis?.suggestedReviewers;
  const needsQuestions = !analysis?.questions || missingQuestionIds.length > 0;
  const needsTraces =
    shape.requireTraces && (!analysis?.traces || analysis.traces.length === 0);

  return {
    needsChangeGroups,
    needsContributors,
    needsSuggestedReviewers,
    needsQuestions,
    missingQuestionIds,
    needsTraces,
  };
}

export async function analyzeChanges(
  prData: PRData,
  options: AnalyzeOptions
): Promise<Analysis> {
  const { additions, deletions } = calculateStats(prData);
  const changeGroups = await buildChangeGroups(prData, options);
  const contributors = await buildContributors(prData);
  const suggestedReviewers = buildSuggestedReviewers(prData, contributors);
  const questionsResult = buildQuestions(prData, changeGroups, contributors);

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
    questions: questionsResult.questions,
    contributors,
    suggestedReviewers,
  };
}

export async function ensureAnalysis(
  prData: PRData,
  options: AnalyzeOptions,
  existing?: Analysis
): Promise<AnalysisUpdateResult> {
  if (!existing) {
    const analysis = await analyzeChanges(prData, options);
    const shape = getAnalysisShape({ includeTraces: options.includeTraces });
    return {
      analysis,
      updated: true,
      missing: getMissingAnalysisParts(analysis, shape),
    };
  }

  const shape = getAnalysisShape({ includeTraces: options.includeTraces });
  const missing = getMissingAnalysisParts(existing, shape);

  const changeGroups = missing.needsChangeGroups
    ? await buildChangeGroups(prData, options)
    : existing.changeGroups;
  const contributors = missing.needsContributors
    ? await buildContributors(prData)
    : existing.contributors;
  const suggestedReviewers = missing.needsSuggestedReviewers
    ? buildSuggestedReviewers(prData, contributors)
    : existing.suggestedReviewers;
  const questionsResult = buildQuestions(
    prData,
    changeGroups,
    contributors,
    existing.questions
  );

  const { additions, deletions } = calculateStats(prData);
  const updatedAnalysis: Analysis = {
    ...existing,
    prUrl: existing.prUrl ?? prData.url,
    title: existing.title ?? prData.title,
    description: existing.description ?? prData.body,
    author: existing.author ?? prData.author,
    baseBranch: existing.baseBranch ?? prData.baseBranch,
    headBranch: existing.headBranch ?? prData.headBranch,
    analyzedAt: new Date(),
    filesChanged: existing.filesChanged ?? prData.files.length,
    additions: existing.additions ?? additions,
    deletions: existing.deletions ?? deletions,
    changeGroups,
    questions: questionsResult.questions,
    contributors,
    suggestedReviewers,
  };

  const updated =
    missing.needsChangeGroups ||
    missing.needsContributors ||
    missing.needsSuggestedReviewers ||
    missing.needsQuestions ||
    questionsResult.updated;

  return {
    analysis: updated ? updatedAnalysis : existing,
    updated,
    missing: {
      ...missing,
      missingQuestionIds: shape.requiredQuestionIds.filter(
        (id) => !questionsResult.questionIds.has(id)
      ),
    },
  };
}

function calculateStats(prData: PRData): {
  additions: number;
  deletions: number;
} {
  const additions = prData.files.reduce((sum, f) => sum + f.additions, 0);
  const deletions = prData.files.reduce((sum, f) => sum + f.deletions, 0);
  return { additions, deletions };
}

async function buildChangeGroups(
  prData: PRData,
  options: AnalyzeOptions
): Promise<ChangeGroup[]> {
  return chunkDiff(prData.diff, prData.files, { useLLM: options.useLLM });
}

async function buildContributors(prData: PRData): Promise<FileContributor[]> {
  const filePaths = prData.files.map((f) => f.path);
  return aggregateContributors(filePaths);
}

function buildSuggestedReviewers(
  prData: PRData,
  contributors: FileContributor[]
): string[] {
  return contributors
    .filter((c) => !prData.author || !c.email.includes(prData.author))
    .slice(0, 3)
    .map((c) => c.name);
}

function buildQuestions(
  prData: PRData,
  changeGroups: ChangeGroup[],
  contributors: FileContributor[],
  existingQuestions: ReviewQuestion[] = []
): { questions: ReviewQuestion[]; updated: boolean; questionIds: Set<string> } {
  const existingById = new Map(
    existingQuestions.map((question) => [question.id, question])
  );
  let updated = false;
  const standardQuestions = STANDARD_QUESTIONS.map((question) => {
    const existing = existingById.get(question.id);
    const context = getQuestionContext(
      question.id,
      prData,
      changeGroups,
      contributors
    );
    if (!existing) {
      updated = true;
      return {
        ...question,
        answer: undefined,
        context,
      };
    }
    if (existing.question !== question.question) {
      updated = true;
    }
    if (!existing.context || existing.context.length === 0) {
      updated = true;
    }
    return {
      ...existing,
      id: question.id,
      question: question.question,
      context:
        existing.context && existing.context.length > 0
          ? existing.context
          : context,
    };
  });

  const standardIds = new Set(
    STANDARD_QUESTIONS.map((question) => question.id)
  );
  const extraQuestions = existingQuestions.filter(
    (question) => !standardIds.has(question.id)
  );

  const questions = [...standardQuestions, ...extraQuestions];
  const questionIds = new Set(questions.map((question) => question.id));
  if (questions.length !== existingQuestions.length) {
    updated = true;
  }

  return { questions, updated, questionIds };
}

function getQuestionContext(
  questionId: string,
  prData: PRData,
  changeGroups: ChangeGroup[],
  contributors: FileContributor[]
): string {
  switch (questionId) {
    case "reviewers":
      return contributors
        .slice(0, 5)
        .map(
          (c) => `${c.name} (${c.linesAuthored} lines, ${c.commits} commits)`
        )
        .join("\n");

    case "new-symbols":
      return (
        changeGroups.flatMap((g) => g.symbolsIntroduced || []).join(", ") ||
        "Analysis pending..."
      );

    case "decomposition":
      const filesByDir = new Map<string, string[]>();
      for (const file of prData.files) {
        const dir = file.path.split("/").slice(0, -1).join("/") || ".";
        if (!filesByDir.has(dir)) filesByDir.set(dir, []);
        filesByDir.get(dir)!.push(file.path);
      }
      return (
        `Changes span ${filesByDir.size} directories:\n` +
        Array.from(filesByDir.entries())
          .map(([dir, files]) => `  ${dir}/ (${files.length} files)`)
          .join("\n")
      );

    default:
      return "";
  }
}
