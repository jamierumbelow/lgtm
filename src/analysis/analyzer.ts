import { PRData } from "../github/pr.js";
import { aggregateContributors, FileContributor } from "../github/blame.js";
import { chunkDiff, ChangeGroup } from "./chunker.js";
import { TraceMatch } from "./trace-finder.js";
import {
  answerChangesetQuestionsWithLLM,
  ProgressInfo,
} from "../llm/changeset-questions.js";
import { ModelChoice, DEFAULT_MODEL } from "../config.js";

export type ReviewQuestionCategory = "changeset";

export interface ReviewQuestion {
  id: string;
  question: string;
  category: ReviewQuestionCategory;
  model?: ModelChoice;
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
  verbose?: boolean;
  model?: ModelChoice;
  onProgress?: (analysis: Analysis) => void | Promise<void>;
  onStepProgress?: (info: ProgressInfo) => void;
  onChangesetsCreated?: (count: number) => void;
}

export type { ProgressInfo };

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
  needsChangesetQuestions: boolean;
  needsTraces: boolean;
}

export interface AnalysisUpdateResult {
  analysis: Analysis;
  updated: boolean;
  missing: AnalysisCoverage;
}

export const ANALYSIS_SHAPE_VERSION = 1;

const CHANGESET_QUESTIONS: Omit<ReviewQuestion, "answer" | "context">[] = [
  {
    id: "failure-modes",
    category: "changeset",
    model: DEFAULT_MODEL,
    question: "How can this fail? What's already handled?",
  },
  {
    id: "input-domain",
    category: "changeset",
    model: DEFAULT_MODEL,
    question: "What inputs does this change handle?",
  },
  {
    id: "duplication",
    category: "changeset",
    model: DEFAULT_MODEL,
    question: "Does this add duplication?",
  },
  {
    id: "abstractions",
    category: "changeset",
    model: DEFAULT_MODEL,
    question: "Do the abstractions make sense?",
  },
  {
    id: "invariants",
    category: "changeset",
    model: DEFAULT_MODEL,
    question: "What invariants change or are added?",
  },
  {
    id: "error-handling",
    category: "changeset",
    model: DEFAULT_MODEL,
    question: "Are error paths fully handled?",
  },
  {
    id: "testing",
    category: "changeset",
    model: DEFAULT_MODEL,
    question: "What tests were added or updated? What's untested?",
  },
  {
    id: "performance",
    category: "changeset",
    model: DEFAULT_MODEL,
    question: "Any impact on latency, memory, or complexity?",
  },
  {
    id: "security-privacy",
    category: "changeset",
    model: DEFAULT_MODEL,
    question: "Does this touch sensitive data or trust boundaries?",
  },
  {
    id: "compatibility",
    category: "changeset",
    model: DEFAULT_MODEL,
    question: "Any behavior or API changes that could break callers?",
  },
  {
    id: "observability",
    category: "changeset",
    model: DEFAULT_MODEL,
    question: "Do we need new or updated logs, metrics, or traces?",
  },
];

const CHANGESET_QUESTION_IDS: Readonly<Record<ChangeGroup["changeType"], string[]>> =
  {
    feature: CHANGESET_QUESTIONS.map((question) => question.id),
    bugfix: ["failure-modes", "error-handling", "testing", "compatibility"],
    refactor: ["abstractions", "duplication", "performance", "compatibility"],
    test: ["testing", "failure-modes"],
    config: ["compatibility", "testing"],
    docs: ["compatibility"],
    types: ["compatibility", "invariants"],
    unknown: ["failure-modes", "testing", "compatibility", "performance"],
  };

function selectChangesetQuestions(
  changeType: ChangeGroup["changeType"]
): Omit<ReviewQuestion, "answer" | "context">[] {
  const ids = CHANGESET_QUESTION_IDS[changeType] ?? [];
  const idsSet = new Set(ids);
  return CHANGESET_QUESTIONS.filter((question) => idsSet.has(question.id));
}

export function getAnalysisShape(
  options: Pick<AnalyzeOptions, "includeTraces"> = {}
): AnalysisShape {
  return {
    version: ANALYSIS_SHAPE_VERSION,
    requiredQuestionIds: [],
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
  const needsChangesetQuestions =
    !analysis?.changeGroups ||
    analysis.changeGroups.some(
      (group) => !group.reviewQuestions || group.reviewQuestions.length === 0
    );
  const needsTraces =
    shape.requireTraces && (!analysis?.traces || analysis.traces.length === 0);

  return {
    needsChangeGroups,
    needsContributors,
    needsSuggestedReviewers,
    needsQuestions,
    missingQuestionIds,
    needsChangesetQuestions,
    needsTraces,
  };
}

export async function analyzeChanges(
  prData: PRData,
  options: AnalyzeOptions
): Promise<Analysis> {
  const { additions, deletions } = calculateStats(prData);
  const changeGroups = await buildChangeGroups(prData, options);

  // Notify that changesets have been created
  if (options.onChangesetsCreated) {
    options.onChangesetsCreated(changeGroups.length);
  }

  const changesetQuestionsResult = buildChangesetQuestions(changeGroups);
  let changeGroupsWithQuestions = changesetQuestionsResult.changeGroups;
  const contributors = await buildContributors(prData);
  const suggestedReviewers = buildSuggestedReviewers(prData, contributors);
  const questionsResult = buildQuestions(prData, changeGroups, contributors);

  // Build a partial analysis for progress callbacks
  const buildPartialAnalysis = (groups: ChangeGroup[]): Analysis => ({
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
    changeGroups: groups,
    questions: questionsResult.questions,
    contributors,
    suggestedReviewers,
  });

  if (options.useLLM) {
    if (options.verbose) {
      console.log(
        `[lgtm] answering changeset questions for ${changeGroupsWithQuestions.length} change groups`
      );
    }
    const answeredChangesets = await answerChangesetQuestionsWithLLM(
      changeGroupsWithQuestions,
      {
        verbose: options.verbose,
        model: options.model,
        onQuestionAnswered: options.onProgress
          ? (groups) => options.onProgress!(buildPartialAnalysis(groups))
          : undefined,
        onProgress: options.onStepProgress,
      }
    );
    changeGroupsWithQuestions = answeredChangesets.changeGroups;
  }

  return buildPartialAnalysis(changeGroupsWithQuestions);
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

  // Notify that changesets have been created (even from cache, for consistency)
  if (options.onChangesetsCreated) {
    options.onChangesetsCreated(changeGroups.length);
  }

  const contributors = missing.needsContributors
    ? await buildContributors(prData)
    : existing.contributors;
  const suggestedReviewers = missing.needsSuggestedReviewers
    ? buildSuggestedReviewers(prData, contributors)
    : existing.suggestedReviewers;
  const changesetQuestionsResult = buildChangesetQuestions(
    changeGroups,
    existing.changeGroups
  );
  let changeGroupsWithQuestions = changesetQuestionsResult.changeGroups;
  let changesetAnswersUpdated = false;

  const { additions, deletions } = calculateStats(prData);

  // Build a partial analysis for progress callbacks (uses existing.questions as
  // questionsResult isn't available until after LLM calls complete)
  const buildPartialAnalysis = (
    groups: ChangeGroup[],
    questions: ReviewQuestion[] = existing.questions
  ): Analysis => ({
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
    changeGroups: groups,
    questions,
    contributors,
    suggestedReviewers,
  });

  if (options.useLLM) {
    if (options.verbose) {
      console.log(
        `[lgtm] answering changeset questions for ${changeGroupsWithQuestions.length} change groups`
      );
    }
    const answeredChangesets = await answerChangesetQuestionsWithLLM(
      changeGroupsWithQuestions,
      {
        verbose: options.verbose,
        model: options.model,
        onQuestionAnswered: options.onProgress
          ? (groups) => options.onProgress!(buildPartialAnalysis(groups))
          : undefined,
        onProgress: options.onStepProgress,
      }
    );
    changeGroupsWithQuestions = answeredChangesets.changeGroups;
    changesetAnswersUpdated = answeredChangesets.updated;
  }
  const questionsResult = buildQuestions(
    prData,
    changeGroupsWithQuestions,
    contributors,
    existing.questions
  );

  const updatedAnalysis: Analysis = buildPartialAnalysis(
    changeGroupsWithQuestions,
    questionsResult.questions
  );

  const updated =
    missing.needsChangeGroups ||
    missing.needsContributors ||
    missing.needsSuggestedReviewers ||
    missing.needsQuestions ||
    questionsResult.updated ||
    changesetQuestionsResult.updated ||
    changesetAnswersUpdated;

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
  _prData: PRData,
  _changeGroups: ChangeGroup[],
  _contributors: FileContributor[],
  existingQuestions: ReviewQuestion[] = []
): { questions: ReviewQuestion[]; updated: boolean; questionIds: Set<string> } {
  // No overview questions - all questions are now per-changeset
  const questions = existingQuestions.filter(
    (question) => question.category === "changeset"
  );
  const questionIds = new Set(questions.map((question) => question.id));
  const updated = questions.length !== existingQuestions.length;

  return { questions, updated, questionIds };
}

function buildChangesetQuestions(
  changeGroups: ChangeGroup[],
  existingChangeGroups: ChangeGroup[] = []
): { changeGroups: ChangeGroup[]; updated: boolean } {
  const existingById = new Map(
    existingChangeGroups.map((group) => [group.id, group])
  );
  let updated = false;

  const updatedGroups = changeGroups.map((group) => {
    const selectedQuestions = selectChangesetQuestions(group.changeType);
    const existingGroup = existingById.get(group.id);
    const existingQuestions = existingGroup?.reviewQuestions ?? [];
    const existingQuestionsById = new Map(
      existingQuestions.map((question) => [question.id, question])
    );

    const reviewQuestions = selectedQuestions.map((question) => {
      const existing = existingQuestionsById.get(question.id);
      if (!existing) {
        updated = true;
        return {
          ...question,
          answer: undefined,
          context: undefined,
        };
      }
      if (existing.question !== question.question) {
        updated = true;
      }
      if (existing.category !== question.category) {
        updated = true;
      }
      return {
        ...existing,
        id: question.id,
        question: question.question,
        category: question.category,
        model: existing.model ?? question.model ?? DEFAULT_MODEL,
      };
    });

    if (existingQuestions.length !== reviewQuestions.length) {
      updated = true;
    }

    return {
      ...group,
      reviewQuestions,
    };
  });

  return { changeGroups: updatedGroups, updated };
}
