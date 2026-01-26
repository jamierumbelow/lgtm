import { PRFile } from "../github/pr.js";
import type { ReviewQuestion } from "./analyzer.js";
export interface ChunkOptions {
    useLLM?: boolean;
}
export interface DiffHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    content: string;
    header: string;
}
export interface FileDiff {
    path: string;
    previousPath?: string;
    status: PRFile["status"];
    hunks: DiffHunk[];
}
export interface ChangeGroup {
    id: string;
    title: string;
    description?: string;
    files: string[];
    hunks: Array<{
        file: string;
        hunk: DiffHunk;
    }>;
    symbolsIntroduced?: string[];
    symbolsModified?: string[];
    reviewQuestions?: ReviewQuestion[];
    changeType: "feature" | "refactor" | "bugfix" | "test" | "config" | "docs" | "types" | "unknown";
}
/**
 * Parse a unified diff into structured file diffs
 */
export declare function parseDiff(diff: string): FileDiff[];
/**
 * Group diff hunks into logical change groups
 */
export declare function chunkDiff(diff: string, files: PRFile[], options?: ChunkOptions): Promise<ChangeGroup[]>;
/**
 * Heuristic-based chunking (fallback when LLM is unavailable)
 */
export declare function chunkDiffHeuristic(diff: string): ChangeGroup[];
