import { generateObject } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  getAnthropicApiKey,
  getOpenAIApiKey,
  getGoogleApiKey,
} from "../secrets.js";
import { recordLLMUsage } from "./usage.js";
import { ModelChoice, DEFAULT_MODEL } from "../config.js";
import { getModelSpec, addPromptSuffix } from "./models.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "../../prompts");

export function loadPrompt(
  promptPath: string,
  model: ModelChoice = DEFAULT_MODEL
): string {
  const modelPromptPath = addPromptSuffix(
    promptPath,
    getModelSpec(model).promptSuffix
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
}

export async function generateStructured<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: import("zod").ZodType<T>,
  options: LLMOptions = {}
): Promise<T> {
  const {
    model = DEFAULT_MODEL,
    temperature = 0.2,
    maxTokens = 4096,
  } = options;
  const modelSpec = getModelSpec(model);
  const modelClient = await getModelClient(modelSpec);

  const result = await generateObject({
    model: modelClient(modelSpec.modelId),
    system: systemPrompt,
    prompt: userPrompt,
    schema,
    temperature,
    maxTokens,
  });

  recordLLMUsage(
    result.usage,
    modelSpec.modelId,
    (result as { cost?: number; costUsd?: number }).cost ??
      (result as { cost?: number; costUsd?: number }).costUsd
  );

  return result.object;
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
  }
}
