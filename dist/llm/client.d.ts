import { ModelChoice } from "../config.js";
export declare function loadPrompt(promptPath: string, model?: ModelChoice): string;
export interface LLMOptions {
    model?: ModelChoice;
    temperature?: number;
    maxTokens?: number;
    verbose?: boolean;
}
export declare function generateStructured<T>(systemPrompt: string, userPrompt: string, schema: import("zod").ZodType<T>, options?: LLMOptions): Promise<T>;
