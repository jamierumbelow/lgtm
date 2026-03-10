import { getRawUserDefaultModel } from "./preferences.js";

export enum ModelChoice {
  ClaudeSonnet45 = "claude-sonnet-4.5",
  ClaudeSonnet46 = "claude-sonnet-4.6",
  ClaudeOpus45 = "claude-opus-4.5",
  ClaudeOpus46 = "claude-opus-4.6",
  Gpt52 = "gpt-5.2",
  Gpt53Codex = "gpt-5.3-codex",
  Gemini3Flash = "gemini-3-flash",
  ClaudeCode = "claude-code",
  Codex = "codex",
}

/** Built-in fallback when no user preference is set */
export const BUILTIN_DEFAULT_MODEL = ModelChoice.ClaudeSonnet46;

/** Get the user's configured default model, or undefined if not set */
export function getUserDefaultModel(): ModelChoice | undefined {
  const raw = getRawUserDefaultModel();
  if (!raw) return undefined;
  const valid = Object.values(ModelChoice) as string[];
  return valid.includes(raw) ? (raw as ModelChoice) : undefined;
}

/** Effective default: user preference if set, otherwise built-in */
export function getDefaultModel(): ModelChoice {
  return getUserDefaultModel() ?? BUILTIN_DEFAULT_MODEL;
}

/**
 * @deprecated Use getDefaultModel() for runtime default.
 * Kept as a static alias for compile-time contexts (prompt suffixes, etc.)
 */
export const DEFAULT_MODEL = BUILTIN_DEFAULT_MODEL;
