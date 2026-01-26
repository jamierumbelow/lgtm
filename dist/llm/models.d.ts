import { ModelChoice } from "../config.js";
export type ModelProvider = "anthropic" | "openai" | "google";
export interface ModelSpec {
    provider: ModelProvider;
    modelId: string;
    promptSuffix: string;
    label: string;
}
export declare const MODEL_SPECS: Record<ModelChoice, ModelSpec>;
export declare function getModelSpec(model?: ModelChoice): ModelSpec;
export declare function addPromptSuffix(promptPath: string, suffix: string): string;
