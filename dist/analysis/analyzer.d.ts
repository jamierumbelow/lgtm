import { PRData } from "../github/pr.js";
import { FileContributor } from "../github/blame.js";
import { ChangeGroup } from "./chunker.js";
import { TraceMatch } from "./trace-finder.js";
import { ProgressInfo } from "../llm/changeset-questions.js";
import { ModelChoice } from "../config.js";
export type ReviewQuestionCategory = "overview" | "changeset";
export interface ReviewQuestion {
    id: string;
    question: string;
    category: ReviewQuestionCategory;
    model?: ModelChoice;
    answer?: string;
    context?: string;
}
export interface Analysis {
    prUrl?: string;
    title?: string;
    description?: string;
    author?: string;
    baseBranch: string;
    headBranch: string;
    analyzedAt: Date;
    filesChanged: number;
    additions: number;
    deletions: number;
    changeGroups: ChangeGroup[];
    questions: ReviewQuestion[];
    contributors: FileContributor[];
    suggestedReviewers: string[];
    traces?: TraceMatch[];
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
export declare const ANALYSIS_SHAPE_VERSION = 1;
export declare function getAnalysisShape(options?: Pick<AnalyzeOptions, "includeTraces">): AnalysisShape;
export declare function getMissingAnalysisParts(analysis: Analysis | undefined, shape: AnalysisShape): AnalysisCoverage;
export declare function analyzeChanges(prData: PRData, options: AnalyzeOptions): Promise<Analysis>;
export declare function ensureAnalysis(prData: PRData, options: AnalyzeOptions, existing?: Analysis): Promise<AnalysisUpdateResult>;
