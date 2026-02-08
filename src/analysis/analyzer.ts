import { PRData } from "../github/pr.js";
import { aggregateContributors, FileContributor } from "../github/blame.js";
import { ChangeGroup } from "./chunker.js";
import { chunkDiff } from "./chunker.js";
import { TraceMatch } from "./trace-finder.js";
import { reviewDiffWithLLM, ReviewDiffResult } from "../llm/review.js";
import { generateExecutiveSummary } from "../llm/executive-summary.js";
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

  // Executive summary — high-level narrative of the PR
  summary?: string;

  // Review guidance — where should the reviewer focus?
  reviewGuidance?: string;

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

export interface ProgressInfo {
  step: string;
  current: number;
  total: number;
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

/**
 * Analyze changes in a PR/diff.
 *
 * When LLM is enabled, this makes a SINGLE LLM call that both splits the diff
 * into changesets AND answers all review questions — replacing the old N+1 call
 * pipeline. Blame is run in parallel with the LLM call.
 */
export async function analyzeChanges(
  prData: PRData,
  options: AnalyzeOptions
): Promise<Analysis> {
  const { additions, deletions } = calculateStats(prData);

  options.onStepProgress?.({
    step: "Analyzing changes...",
    current: 0,
    total: 2,
  });

  // Run LLM review and contributor analysis IN PARALLEL.
  // The LLM call doesn't need blame data, and blame doesn't need changesets.
  // The single-pass LLM call now includes the executive summary, eliminating
  // the need for a separate round trip.
  const [reviewResult, contributors] = await Promise.all([
    buildChangeGroupsWithReview(prData, options),
    buildContributors(prData),
  ]);

  const { changeGroups, summary, reviewGuidance } = reviewResult;

  // Notify that changesets have been created
  if (options.onChangesetsCreated) {
    options.onChangesetsCreated(changeGroups.length);
  }

  options.onStepProgress?.({
    step: "Analysis complete",
    current: 2,
    total: 2,
  });

  const suggestedReviewers = buildSuggestedReviewers(prData, contributors);

  // Collect all changeset questions into the top-level questions array
  const questions = changeGroups.flatMap(
    (group) =>
      group.reviewQuestions?.filter((q) => q.category === "changeset") ?? []
  );

  const analysis: Analysis = {
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
    summary,
    reviewGuidance,
  };

  // If the single-pass call didn't produce a summary (e.g. heuristic fallback),
  // fall back to a separate executive summary call
  if (options.useLLM && !analysis.summary && changeGroups.length > 0) {
    try {
      options.onStepProgress?.({
        step: "Generating executive summary...",
        current: 2,
        total: 2,
      });
      const executiveSummary = await generateExecutiveSummary(
        changeGroups,
        {
          title: prData.title,
          description: prData.body,
          author: prData.author,
          baseBranch: prData.baseBranch,
          headBranch: prData.headBranch,
          filesChanged: prData.files.length,
          additions,
          deletions,
        },
        { model: options.model, verbose: options.verbose }
      );
      analysis.summary = executiveSummary.summary;
      analysis.reviewGuidance = executiveSummary.reviewGuidance;
    } catch (error) {
      if (options.verbose) {
        console.warn("[lgtm] failed to generate executive summary:", error);
      }
    }
  }

  return analysis;
}

/**
 * Ensure an existing analysis is up to date.
 * If the cached analysis is complete, returns it as-is.
 * If anything is missing, re-runs the full analysis (single LLM call).
 */
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

  // If nothing substantial is missing, return the existing analysis as-is
  const needsSummary =
    options.useLLM && (!existing.summary || !existing.reviewGuidance);
  const needsUpdate =
    missing.needsChangeGroups ||
    missing.needsContributors ||
    missing.needsSuggestedReviewers ||
    missing.needsChangesetQuestions;

  if (!needsUpdate && !needsSummary) {
    return { analysis: existing, updated: false, missing };
  }

  // If only the summary is missing, just generate that
  if (!needsUpdate && needsSummary && existing.changeGroups.length > 0) {
    try {
      const { additions, deletions } = calculateStats(prData);
      const executiveSummary = await generateExecutiveSummary(
        existing.changeGroups,
        {
          title: prData.title,
          description: prData.body,
          author: prData.author,
          baseBranch: prData.baseBranch,
          headBranch: prData.headBranch,
          filesChanged: prData.files.length,
          additions,
          deletions,
        },
        { model: options.model, verbose: options.verbose }
      );
      const updated = {
        ...existing,
        summary: executiveSummary.summary,
        reviewGuidance: executiveSummary.reviewGuidance,
      };
      return { analysis: updated, updated: true, missing };
    } catch (error) {
      if (options.verbose) {
        console.warn("[lgtm] failed to generate executive summary:", error);
      }
      return { analysis: existing, updated: false, missing };
    }
  }

  // Re-run full analysis — the single-call approach makes incremental
  // updates less valuable since it's just one LLM call anyway.
  const analysis = await analyzeChanges(prData, options);
  return {
    analysis,
    updated: true,
    missing: getMissingAnalysisParts(analysis, shape),
  };
}

// --- Internal helpers ---

function calculateStats(prData: PRData): {
  additions: number;
  deletions: number;
} {
  const additions = prData.files.reduce((sum, f) => sum + f.additions, 0);
  const deletions = prData.files.reduce((sum, f) => sum + f.deletions, 0);
  return { additions, deletions };
}

/**
 * When LLM is enabled, uses the single-pass review function that splits,
 * answers questions, AND generates the executive summary in one call.
 * Falls back to heuristic chunking when LLM is disabled.
 */
async function buildChangeGroupsWithReview(
  prData: PRData,
  options: AnalyzeOptions
): Promise<ReviewDiffResult> {
  if (options.useLLM) {
    return reviewDiffWithLLM(prData.diff, {
      model: options.model,
      verbose: options.verbose,
      onProgress: options.onStepProgress
        ? (info) =>
            options.onStepProgress!({
              step: info.step,
              current: 1,
              total: 2,
            })
        : undefined,
    });
  }

  // Heuristic fallback (no LLM)
  const changeGroups = await chunkDiff(prData.diff, prData.files, {
    useLLM: false,
  });
  return { changeGroups };
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
