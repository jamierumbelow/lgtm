import { ModelChoice, getDefaultModel } from "../config.js";

export type ModelProvider = "anthropic" | "openai" | "google" | "cli";

export interface ModelSpec {
  provider: ModelProvider;
  modelId: string;
  promptSuffix: string;
  label: string;
  /** For CLI providers, the command to invoke (e.g. "claude", "codex") */
  cliCommand?: string;
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
  [ModelChoice.ClaudeOpus46]: {
    provider: "anthropic",
    modelId: "claude-opus-4-6-20260205",
    promptSuffix: "claude-opus-4.5",
    label: "Claude Opus 4.6 (2026-02-05)",
  },
  [ModelChoice.Gpt52]: {
    provider: "openai",
    modelId: "gpt-5.2",
    promptSuffix: "gpt-5.2",
    label: "GPT-5.2",
  },
  [ModelChoice.Gpt53Codex]: {
    provider: "openai",
    modelId: "gpt-5.3-codex",
    promptSuffix: "gpt-5.2",
    label: "GPT-5.3 Codex",
  },
  [ModelChoice.Gemini3Flash]: {
    provider: "google",
    modelId: "gemini-3-flash",
    promptSuffix: "gemini-3-flash",
    label: "Gemini 3 Flash",
  },
  [ModelChoice.ClaudeCode]: {
    provider: "cli",
    modelId: "claude-code",
    promptSuffix: "claude-sonnet-4.5",
    cliCommand: "claude",
    label: "Claude Code (CLI)",
  },
  [ModelChoice.Codex]: {
    provider: "cli",
    modelId: "codex",
    promptSuffix: "gpt-5.2",
    cliCommand: "codex",
    label: "Codex (CLI)",
  },
};

export function getModelSpec(model?: ModelChoice): ModelSpec {
  return MODEL_SPECS[model ?? getDefaultModel()];
}

export function addPromptSuffix(promptPath: string, suffix: string): string {
  const index = promptPath.lastIndexOf(".txt");
  if (index === -1) {
    return `${promptPath}.${suffix}`;
  }
  return `${promptPath.slice(0, index)}.${suffix}${promptPath.slice(index)}`;
}
