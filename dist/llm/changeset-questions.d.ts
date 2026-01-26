import { LLMOptions } from "./client.js";
import { ChangeGroup } from "../analysis/chunker.js";
export interface ProgressInfo {
    step: string;
    current: number;
    total: number;
}
export declare function answerChangesetQuestionsWithLLM(changeGroups: ChangeGroup[], options?: LLMOptions & {
    verbose?: boolean;
    log?: (message: string) => void;
    maxConcurrent?: number;
    onQuestionAnswered?: (changeGroups: ChangeGroup[]) => void | Promise<void>;
    onProgress?: (info: ProgressInfo) => void;
}): Promise<{
    changeGroups: ChangeGroup[];
    updated: boolean;
}>;
