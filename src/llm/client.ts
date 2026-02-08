import { generateObject, streamObject } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { select } from "@inquirer/prompts";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  getAnthropicApiKey,
  getOpenAIApiKey,
  getGoogleApiKey,
  hasAnthropicApiKey,
  hasOpenAIApiKey,
  hasGoogleApiKey,
} from "../secrets.js";
import { recordLLMUsage, updateStreamingEstimate } from "./usage.js";
import { ModelChoice, getDefaultModel } from "../config.js";
import { getModelSpec, addPromptSuffix, MODEL_SPECS } from "./models.js";
import {
  createPromptCacheKey,
  getCachedPromptResponse,
  getSchemaSignature,
  setCachedPromptResponse,
} from "./prompt-cache.js";
import {
  generateStructuredViaCLI,
  isCLIAvailable,
} from "./cli-provider.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "../../prompts");

let modelOverride: ModelChoice | undefined;
let modelSwitchPrompt: Promise<ModelChoice | undefined> | undefined;
let modelSwitchDeclined = false;
let rateLimitGate: Promise<void> | undefined;
let rateLimitGateResolve: (() => void) | undefined;
let rateLimitGateCount = 0;

export function loadPrompt(
  promptPath: string,
  model?: ModelChoice
): string {
  const effectiveModel = modelOverride ?? model ?? getDefaultModel();
  const modelPromptPath = addPromptSuffix(
    promptPath,
    getModelSpec(effectiveModel).promptSuffix
  );
  const modelFullPath = join(PROMPTS_DIR, modelPromptPath);
  if (existsSync(modelFullPath)) {
    return readFileSync(modelFullPath, "utf-8");
  }
  const fullPath = join(PROMPTS_DIR, promptPath);
  return readFileSync(fullPath, "utf-8");
}

export interface LLMOptions {
  model?: ModelChoice;
  temperature?: number;
  maxTokens?: number;
  verbose?: boolean;
}

export async function generateStructured<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: import("zod").ZodType<T>,
  options: LLMOptions = {}
): Promise<T> {
  const {
    model: requestedModel,
    temperature = 0.2,
    maxTokens = 4096,
    verbose = false,
  } = options;
  let currentModel = modelOverride ?? requestedModel ?? getDefaultModel();
  let modelSpec = getModelSpec(currentModel);

  // CLI provider path — delegate to subprocess-based provider
  if (modelSpec.provider === "cli") {
    const cacheKey = createPromptCacheKey({
      modelId: modelSpec.modelId,
      systemPrompt,
      userPrompt,
      schemaSignature: getSchemaSignature(schema),
      temperature,
      maxTokens,
    });
    const cached = getCachedPromptResponse<T>(cacheKey);
    if (cached) return cached;

    const result = await generateStructuredViaCLI(
      systemPrompt,
      userPrompt,
      schema,
      modelSpec,
      { verbose }
    );
    setCachedPromptResponse(cacheKey, result);
    return result;
  }

  // AI SDK provider path
  let modelClient = await getModelClient(modelSpec);

  const maxRateLimitRetries = 3;
  let rateLimitAttempts = 0;

  while (true) {
    try {
      await waitForRateLimitGate();
      const cacheKey = createPromptCacheKey({
        modelId: modelSpec.modelId,
        systemPrompt,
        userPrompt,
        schemaSignature: getSchemaSignature(schema),
        temperature,
        maxTokens,
      });
      const cached = getCachedPromptResponse<T>(cacheKey);
      if (cached) {
        return cached;
      }
      // Estimate input tokens from prompt size (~4 chars/token)
      const estimatedInputTokens = Math.ceil(
        (systemPrompt.length + userPrompt.length) / 4
      );
      updateStreamingEstimate(estimatedInputTokens);

      const stream = streamObject({
        model: modelClient(modelSpec.modelId),
        system: systemPrompt,
        prompt: userPrompt,
        schema,
        temperature,
        maxTokens,
      });

      // Count output characters as they stream for live token estimates
      let outputChars = 0;
      for await (const chunk of stream.fullStream) {
        if (chunk.type === "text-delta") {
          outputChars += chunk.textDelta.length;
          const estimatedOutputTokens = Math.ceil(outputChars / 4);
          updateStreamingEstimate(estimatedInputTokens + estimatedOutputTokens);
        }
      }

      // Stream is done — record real usage (clears the estimate)
      const usage = await stream.usage;
      recordLLMUsage(
        usage,
        modelSpec.modelId,
        (stream as unknown as { cost?: number; costUsd?: number }).cost ??
          (stream as unknown as { cost?: number; costUsd?: number }).costUsd
      );

      const result = await stream.object;
      setCachedPromptResponse(cacheKey, result);
      return result;
    } catch (error) {
      if (
        !isRateLimitError(error) ||
        rateLimitAttempts >= maxRateLimitRetries
      ) {
        throw error;
      }

      const releaseGate = enterRateLimitGate();
      try {
        const waitSeconds = inferRateLimitWaitSeconds(error);
        const switchedModel = await maybeOfferModelSwitch(
          currentModel,
          waitSeconds
        );
        if (switchedModel && switchedModel !== currentModel) {
          currentModel = switchedModel;
          modelSpec = getModelSpec(currentModel);
          modelClient = await getModelClient(modelSpec);
          rateLimitAttempts = 0;
          continue;
        }

        rateLimitAttempts += 1;
        if (verbose) {
          notifyRateLimitWait(
            modelSpec.modelId,
            waitSeconds,
            rateLimitAttempts
          );
        }
        await waitWithProgress(waitSeconds, verbose);
      } finally {
        releaseGate();
      }
    }
  }
}

async function getModelClient(modelSpec: ReturnType<typeof getModelSpec>) {
  switch (modelSpec.provider) {
    case "anthropic": {
      const apiKey = await getAnthropicApiKey();
      if (!apiKey) {
        throw new Error(
          "Anthropic API key not configured. Run `lgtm config` or set ANTHROPIC_API_KEY environment variable."
        );
      }
      return createAnthropic({ apiKey });
    }
    case "openai": {
      const apiKey = await getOpenAIApiKey();
      if (!apiKey) {
        throw new Error(
          "OpenAI API key not configured. Run `lgtm config` or set OPENAI_API_KEY environment variable."
        );
      }
      return createOpenAI({ apiKey });
    }
    case "google": {
      const apiKey = await getGoogleApiKey();
      if (!apiKey) {
        throw new Error(
          "Gemini API key not configured. Run `lgtm config` or set GOOGLE_GENERATIVE_AI_API_KEY environment variable."
        );
      }
      return createGoogleGenerativeAI({ apiKey });
    }
    case "cli":
      throw new Error(
        "CLI providers should not use getModelClient — this is a bug."
      );
  }
}

function isRateLimitError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      if (hasRateLimitMessage(current.message)) return true;
      if (hasRateLimitStatus(current)) return true;
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    if (typeof current === "object") {
      if (hasRateLimitStatus(current as Record<string, unknown>)) return true;
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    break;
  }

  return false;
}

function hasRateLimitMessage(message: string): boolean {
  return /rate limit/i.test(message);
}

function hasRateLimitStatus(
  errorLike: Error | Record<string, unknown>
): boolean {
  const statusCode = (errorLike as { statusCode?: number }).statusCode;
  const status = (errorLike as { status?: number }).status;
  return statusCode === 429 || status === 429;
}

function inferRateLimitWaitSeconds(error: unknown): number {
  const retryAfterSeconds = extractRetryAfterSeconds(error);
  if (retryAfterSeconds) {
    return Math.max(1, Math.round(retryAfterSeconds));
  }

  const limitPerMinute = extractRateLimitPerMinute(error);
  if (limitPerMinute && Number.isFinite(limitPerMinute)) {
    return Math.max(1, Math.ceil(60 / limitPerMinute) + 1);
  }

  return 15;
}

function extractRetryAfterSeconds(error: unknown): number | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && !seen.has(current)) {
    seen.add(current);
    const retryAfter = readRetryAfterHeader(current);
    if (retryAfter !== undefined) return retryAfter;

    if (current instanceof Error) {
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    if (typeof current === "object") {
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    break;
  }

  return undefined;
}

function readRetryAfterHeader(errorLike: unknown): number | undefined {
  if (!errorLike || typeof errorLike !== "object") return undefined;
  const response = (errorLike as { response?: unknown }).response;
  if (!response || typeof response !== "object") return undefined;

  const headers = (response as { headers?: unknown }).headers;
  if (!headers) return undefined;

  if (typeof (headers as { get?: unknown }).get === "function") {
    const raw = (headers as { get: (name: string) => string | null }).get(
      "retry-after"
    );
    return parseRetryAfter(raw);
  }

  if (typeof headers === "object") {
    const raw = (headers as Record<string, unknown>)["retry-after"];
    if (typeof raw === "string") {
      return parseRetryAfter(raw);
    }
  }

  return undefined;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return seconds;

  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const deltaMs = dateMs - Date.now();
    if (deltaMs > 0) return Math.ceil(deltaMs / 1000);
  }

  return undefined;
}

function extractRateLimitPerMinute(error: unknown): number | undefined {
  const message = extractErrorMessage(error);
  if (!message) return undefined;
  const match = message.match(/(\d+)\s*requests per minute/i);
  if (!match) return undefined;
  return Number(match[1]);
}

function extractErrorMessage(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      if (current.message) return current.message;
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    if (typeof current === "object") {
      const message = (current as { message?: unknown }).message;
      if (typeof message === "string") return message;
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    break;
  }

  return undefined;
}

function notifyRateLimitWait(
  modelId: string,
  waitSeconds: number,
  attempt: number
): void {
  const seconds = Math.max(1, Math.round(waitSeconds));
  const label = attempt === 1 ? "retry" : `retry ${attempt.toString()}`;
  console.warn(
    `[lgtm] rate limited by ${modelId}; waiting ${seconds}s before ${label}`
  );
}

function waitWithProgress(waitSeconds: number, verbose = false): Promise<void> {
  const seconds = Math.max(0, Math.round(waitSeconds));
  if (seconds === 0) {
    return Promise.resolve();
  }

  if (verbose) {
    process.stdout.write("[lgtm] waiting");
  }
  return new Promise((resolve) => {
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 1;
      if (verbose) {
        process.stdout.write(".");
      }
      if (elapsed >= seconds) {
        clearInterval(interval);
        if (verbose) {
          process.stdout.write("\n");
        }
        resolve();
      }
    }, 1000);
  });
}

function enterRateLimitGate(): () => void {
  rateLimitGateCount += 1;
  if (!rateLimitGate) {
    rateLimitGate = new Promise((resolve) => {
      rateLimitGateResolve = resolve;
    });
  }

  return () => {
    rateLimitGateCount = Math.max(0, rateLimitGateCount - 1);
    if (rateLimitGateCount === 0 && rateLimitGateResolve) {
      rateLimitGateResolve();
      rateLimitGateResolve = undefined;
      rateLimitGate = undefined;
    }
  };
}

async function waitForRateLimitGate(): Promise<void> {
  if (!rateLimitGate) return;
  await rateLimitGate;
}

async function maybeOfferModelSwitch(
  currentModel: ModelChoice,
  waitSeconds: number
): Promise<ModelChoice | undefined> {
  if (!isInteractive() || modelSwitchDeclined) {
    return undefined;
  }

  const alternatives = await getAvailableAlternativeModels(currentModel);
  if (alternatives.length === 0) {
    return undefined;
  }

  if (!modelSwitchPrompt) {
    modelSwitchPrompt = promptForModelSwitch(
      currentModel,
      alternatives,
      waitSeconds
    ).finally(() => {
      modelSwitchPrompt = undefined;
    });
  }

  return await modelSwitchPrompt;
}

async function promptForModelSwitch(
  currentModel: ModelChoice,
  alternatives: ModelChoice[],
  waitSeconds: number
): Promise<ModelChoice | undefined> {
  const currentLabel = MODEL_SPECS[currentModel].label;
  const displayWait = Math.max(1, Math.round(waitSeconds));
  const choice = await select({
    message: `Rate limited on ${currentLabel}. Wait ${displayWait}s or switch models?`,
    choices: [
      { name: `Wait ${displayWait}s`, value: "wait" },
      ...alternatives.map((model) => ({
        name: `Switch to ${MODEL_SPECS[model].label}`,
        value: model,
      })),
    ],
  });

  if (choice === "wait") {
    modelSwitchDeclined = true;
    return undefined;
  }

  const selectedModel = choice as ModelChoice;
  modelOverride = selectedModel;
  console.warn(`[lgtm] switching model to ${MODEL_SPECS[selectedModel].label}`);
  return selectedModel;
}

async function getAvailableAlternativeModels(
  currentModel: ModelChoice
): Promise<ModelChoice[]> {
  const hasAnthropic = await hasAnthropicApiKey();
  const hasOpenAI = await hasOpenAIApiKey();
  const hasGoogle = await hasGoogleApiKey();

  // Check CLI tool availability (cached per call)
  const cliAvailabilityCache = new Map<string, boolean>();
  const checkCLI = async (command: string): Promise<boolean> => {
    if (!cliAvailabilityCache.has(command)) {
      cliAvailabilityCache.set(command, await isCLIAvailable(command));
    }
    return cliAvailabilityCache.get(command)!;
  };

  const isAvailable = async (model: ModelChoice): Promise<boolean> => {
    const spec = MODEL_SPECS[model];
    if (spec.provider === "anthropic") return hasAnthropic;
    if (spec.provider === "openai") return hasOpenAI;
    if (spec.provider === "google") return hasGoogle;
    if (spec.provider === "cli") return checkCLI(spec.cliCommand!);
    return false;
  };

  const currentProvider = MODEL_SPECS[currentModel].provider;
  const candidates = Object.values(ModelChoice).filter((model) => {
    if (model === currentModel) return false;
    if (MODEL_SPECS[model].provider === currentProvider) return false;
    return true;
  });

  const results = await Promise.all(
    candidates.map(async (model) => ({
      model,
      available: await isAvailable(model),
    }))
  );

  return results.filter((r) => r.available).map((r) => r.model);
}

function isInteractive(): boolean {
  return Boolean(
    process.stdin?.isTTY && process.stdout?.isTTY && !process.env.CI
  );
}
