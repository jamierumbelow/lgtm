export var ModelChoice;
(function (ModelChoice) {
    ModelChoice["ClaudeSonnet45"] = "claude-sonnet-4.5";
    ModelChoice["ClaudeOpus45"] = "claude-opus-4.5";
    ModelChoice["Gpt52"] = "gpt-5.2";
    ModelChoice["Gemini3Flash"] = "gemini-3-flash";
})(ModelChoice || (ModelChoice = {}));
export const DEFAULT_MODEL = ModelChoice.ClaudeSonnet45;
export const DEFAULT_CHANGESET_QUESTION_CONCURRENCY = 3;
