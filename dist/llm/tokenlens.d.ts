import type { LLMUsageRecord } from "./usage.js";
export declare function calculateTokenlensCost(records: LLMUsageRecord[], log?: (message: string) => void): Promise<number | undefined>;
