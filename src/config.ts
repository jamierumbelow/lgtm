export enum ModelChoice {
  ClaudeSonnet45 = "claude-sonnet-4.5",
  ClaudeOpus45 = "claude-opus-4.5",
  Gpt52 = "gpt-5.2",
  Gemini3Flash = "gemini-3-flash",
}

export const DEFAULT_MODEL = ModelChoice.ClaudeSonnet45;

export const DEFAULT_CHANGESET_QUESTION_CONCURRENCY = 3;
