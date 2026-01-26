type UsageLike = Record<string, unknown> | undefined | null;
export interface LLMUsageRecord {
    model?: string;
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
    totalTokens: number;
}
interface LLMUsageTotals {
    tokenCount: number;
    costUsd: number;
}
export declare function recordLLMUsage(usage?: UsageLike, model?: string, costLike?: unknown): void;
export declare function resetLLMUsage(): void;
export declare function getLLMUsageTotals(): LLMUsageTotals;
export declare function getLLMUsageRecords(): LLMUsageRecord[];
export declare function formatTokenCount(count: number): string;
export declare function getFormattedRunningTotal(): string;
export {};
