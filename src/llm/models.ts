import { ModelChoice, DEFAULT_MODEL } from "../config.js";

export type ModelProvider = "anthropic" | "openai" | "google";

export interface ModelSpec {
  provider: ModelProvider;
  modelId: string;
  promptSuffix: string;
  label: string;
}

export const MODEL_SPECS: Record<ModelChoice, ModelSpec> = {
  [ModelChoice.ClaudeSonnet45]: {
    provider: "anthropic",
    modelId: "claude-sonnet-4-20250514",
    promptSuffix: "claude-sonnet-4.5",
    label: "Claude Sonnet 4 (2025-05-14)",
  },
  [ModelChoice.ClaudeOpus45]: {
    provider: "anthropic",
    modelId: "claude-opus-4-20250514",
    promptSuffix: "claude-opus-4.5",
    label: "Claude Opus 4 (2025-05-14)",
  },
  [ModelChoice.Gpt52]: {
    provider: "openai",
    modelId: "gpt-5.2",
    promptSuffix: "gpt-5.2",
    label: "GPT-5.2",
  },
  [ModelChoice.Gemini3Flash]: {
    provider: "google",
    modelId: "gemini-3-flash",
    promptSuffix: "gemini-3-flash",
    label: "Gemini 3 Flash",
  },
};

export function getModelSpec(model?: ModelChoice): ModelSpec {
  return MODEL_SPECS[model ?? DEFAULT_MODEL];
}

export function addPromptSuffix(promptPath: string, suffix: string): string {
  const index = promptPath.lastIndexOf(".txt");
  if (index === -1) {
    return `${promptPath}.${suffix}`;
  }
  return `${promptPath.slice(0, index)}.${suffix}${promptPath.slice(index)}`;
}
