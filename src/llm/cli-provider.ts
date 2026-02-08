/**
 * CLI-based LLM provider — runs `claude -p` or `codex` as a subprocess
 * to leverage existing Claude Code / Codex subscriptions instead of
 * requiring vendor API keys.
 */

import { spawn } from "child_process";
import { z } from "zod";
import type { ModelSpec } from "./models.js";
import { recordLLMUsage, updateStreamingEstimate } from "./usage.js";

/** Check whether a CLI tool is available on $PATH */
export async function isCLIAvailable(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("which", [command], { stdio: "pipe" });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

/** Build the full prompt that asks for structured JSON output */
function buildStructuredPrompt<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodType<T>
): string {
  const jsonSchema = z.toJSONSchema(schema);

  return `${systemPrompt}

IMPORTANT: You MUST respond with ONLY valid JSON (no markdown fences, no commentary).
The JSON must conform to this JSON Schema:

${JSON.stringify(jsonSchema, null, 2)}

---

${userPrompt}`;
}

/** Extract JSON from a response that may contain markdown code fences */
function extractJSON(raw: string): string {
  const trimmed = raw.trim();

  // Try to extract from ```json ... ``` or ``` ... ``` fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // If the response starts with { or [, assume it's raw JSON
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return trimmed;
  }

  // Last resort: find the first { and last } (or [ and ])
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

/** Parse the `claude -p --output-format json` envelope */
interface ClaudeCLIResult {
  type: string;
  subtype?: string;
  result?: string;
  cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  session_id?: string;
  is_error?: boolean;
}

function parseClaudeEnvelope(raw: string): {
  text: string;
  costUsd?: number;
} {
  try {
    const envelope = JSON.parse(raw) as ClaudeCLIResult;
    if (envelope.type === "result" && typeof envelope.result === "string") {
      return {
        text: envelope.result,
        costUsd: envelope.cost_usd,
      };
    }
  } catch {
    // Not an envelope, treat as raw text
  }
  return { text: raw };
}

/** Run the `claude` CLI with `-p` (prompt mode) */
async function runClaudeCLI(prompt: string): Promise<{
  text: string;
  costUsd?: number;
}> {
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--verbose",
    ];

    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        const errorMsg = stderr.trim() || stdout.trim() || `Exit code ${code}`;
        reject(
          new Error(`claude CLI failed (exit ${code}): ${errorMsg}`)
        );
        return;
      }
      resolve(parseClaudeEnvelope(stdout));
    });

    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            'Claude Code CLI not found. Install it from https://docs.anthropic.com/en/docs/claude-code or run: npm install -g @anthropic-ai/claude-code'
          )
        );
      } else {
        reject(new Error(`Failed to run claude CLI: ${err.message}`));
      }
    });
  });
}

/** Run the `codex` CLI */
async function runCodexCLI(prompt: string): Promise<{
  text: string;
  costUsd?: number;
}> {
  return new Promise((resolve, reject) => {
    const args = ["--quiet", "--full-auto", "-m", "o3", prompt];

    const child = spawn("codex", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        const errorMsg = stderr.trim() || stdout.trim() || `Exit code ${code}`;
        reject(new Error(`codex CLI failed (exit ${code}): ${errorMsg}`));
        return;
      }
      resolve({ text: stdout });
    });

    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            "Codex CLI not found. Install it from https://github.com/openai/codex or run: npm install -g @openai/codex"
          )
        );
      } else {
        reject(new Error(`Failed to run codex CLI: ${err.message}`));
      }
    });
  });
}

/** Dispatch to the appropriate CLI tool */
async function runCLI(
  command: string,
  prompt: string
): Promise<{ text: string; costUsd?: number }> {
  switch (command) {
    case "claude":
      return runClaudeCLI(prompt);
    case "codex":
      return runCodexCLI(prompt);
    default:
      throw new Error(`Unknown CLI provider: ${command}`);
  }
}

/**
 * Generate a structured response using a CLI-based LLM provider.
 * This is the CLI equivalent of the AI SDK's `streamObject`.
 */
export async function generateStructuredViaCLI<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodType<T>,
  modelSpec: ModelSpec,
  options: { verbose?: boolean } = {}
): Promise<T> {
  const command = modelSpec.cliCommand;
  if (!command) {
    throw new Error(
      `Model ${modelSpec.modelId} is a CLI provider but has no cliCommand configured`
    );
  }

  // Check CLI availability
  const available = await isCLIAvailable(command);
  if (!available) {
    throw new Error(
      `${command} CLI not found on PATH. Please install it first.`
    );
  }

  const prompt = buildStructuredPrompt(systemPrompt, userPrompt, schema);

  // Estimate input tokens for progress display
  const estimatedInputTokens = Math.ceil(prompt.length / 4);
  updateStreamingEstimate(estimatedInputTokens);

  if (options.verbose) {
    console.warn(
      `[lgtm] running ${command} CLI (prompt: ~${estimatedInputTokens} tokens)...`
    );
  }

  const { text, costUsd } = await runCLI(command, prompt);
  const jsonStr = extractJSON(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(
      `${command} CLI returned invalid JSON. Raw response:\n${text.slice(0, 500)}`
    );
  }

  // Validate against the schema
  const result = schema.parse(parsed) as T;

  // Estimate output tokens and record usage
  const estimatedOutputTokens = Math.ceil(text.length / 4);
  recordLLMUsage(
    {
      promptTokens: estimatedInputTokens,
      completionTokens: estimatedOutputTokens,
      totalTokens: estimatedInputTokens + estimatedOutputTokens,
    },
    modelSpec.modelId,
    costUsd
  );

  return result;
}
