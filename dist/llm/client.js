import { generateObject } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { select } from "@inquirer/prompts";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getAnthropicApiKey, getOpenAIApiKey, getGoogleApiKey, hasAnthropicApiKey, hasOpenAIApiKey, hasGoogleApiKey, } from "../secrets.js";
import { recordLLMUsage } from "./usage.js";
import { ModelChoice, DEFAULT_MODEL } from "../config.js";
import { getModelSpec, addPromptSuffix, MODEL_SPECS } from "./models.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "../../prompts");
let modelOverride;
let modelSwitchPrompt;
let modelSwitchDeclined = false;
let rateLimitGate;
let rateLimitGateResolve;
let rateLimitGateCount = 0;
export function loadPrompt(promptPath, model = DEFAULT_MODEL) {
    const effectiveModel = modelOverride ?? model;
    const modelPromptPath = addPromptSuffix(promptPath, getModelSpec(effectiveModel).promptSuffix);
    const modelFullPath = join(PROMPTS_DIR, modelPromptPath);
    if (existsSync(modelFullPath)) {
        return readFileSync(modelFullPath, "utf-8");
    }
    const fullPath = join(PROMPTS_DIR, promptPath);
    return readFileSync(fullPath, "utf-8");
}
export async function generateStructured(systemPrompt, userPrompt, schema, options = {}) {
    const { model: requestedModel = DEFAULT_MODEL, temperature = 0.2, maxTokens = 4096, verbose = false, } = options;
    let currentModel = modelOverride ?? requestedModel;
    let modelSpec = getModelSpec(currentModel);
    let modelClient = await getModelClient(modelSpec);
    const maxRateLimitRetries = 3;
    let rateLimitAttempts = 0;
    while (true) {
        try {
            await waitForRateLimitGate();
            const result = await generateObject({
                model: modelClient(modelSpec.modelId),
                system: systemPrompt,
                prompt: userPrompt,
                schema,
                temperature,
                maxTokens,
            });
            recordLLMUsage(result.usage, modelSpec.modelId, result.cost ??
                result.costUsd);
            return result.object;
        }
        catch (error) {
            if (!isRateLimitError(error) ||
                rateLimitAttempts >= maxRateLimitRetries) {
                throw error;
            }
            const releaseGate = enterRateLimitGate();
            try {
                const waitSeconds = inferRateLimitWaitSeconds(error);
                const switchedModel = await maybeOfferModelSwitch(currentModel, waitSeconds);
                if (switchedModel && switchedModel !== currentModel) {
                    currentModel = switchedModel;
                    modelSpec = getModelSpec(currentModel);
                    modelClient = await getModelClient(modelSpec);
                    rateLimitAttempts = 0;
                    continue;
                }
                rateLimitAttempts += 1;
                if (verbose) {
                    notifyRateLimitWait(modelSpec.modelId, waitSeconds, rateLimitAttempts);
                }
                await waitWithProgress(waitSeconds, verbose);
            }
            finally {
                releaseGate();
            }
        }
    }
}
async function getModelClient(modelSpec) {
    switch (modelSpec.provider) {
        case "anthropic": {
            const apiKey = await getAnthropicApiKey();
            if (!apiKey) {
                throw new Error("Anthropic API key not configured. Run `lgtm config` or set ANTHROPIC_API_KEY environment variable.");
            }
            return createAnthropic({ apiKey });
        }
        case "openai": {
            const apiKey = await getOpenAIApiKey();
            if (!apiKey) {
                throw new Error("OpenAI API key not configured. Run `lgtm config` or set OPENAI_API_KEY environment variable.");
            }
            return createOpenAI({ apiKey });
        }
        case "google": {
            const apiKey = await getGoogleApiKey();
            if (!apiKey) {
                throw new Error("Gemini API key not configured. Run `lgtm config` or set GOOGLE_GENERATIVE_AI_API_KEY environment variable.");
            }
            return createGoogleGenerativeAI({ apiKey });
        }
    }
}
function isRateLimitError(error) {
    const seen = new Set();
    let current = error;
    while (current && !seen.has(current)) {
        seen.add(current);
        if (current instanceof Error) {
            if (hasRateLimitMessage(current.message))
                return true;
            if (hasRateLimitStatus(current))
                return true;
            current = current.cause;
            continue;
        }
        if (typeof current === "object") {
            if (hasRateLimitStatus(current))
                return true;
            current = current.cause;
            continue;
        }
        break;
    }
    return false;
}
function hasRateLimitMessage(message) {
    return /rate limit/i.test(message);
}
function hasRateLimitStatus(errorLike) {
    const statusCode = errorLike.statusCode;
    const status = errorLike.status;
    return statusCode === 429 || status === 429;
}
function inferRateLimitWaitSeconds(error) {
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
function extractRetryAfterSeconds(error) {
    const seen = new Set();
    let current = error;
    while (current && !seen.has(current)) {
        seen.add(current);
        const retryAfter = readRetryAfterHeader(current);
        if (retryAfter !== undefined)
            return retryAfter;
        if (current instanceof Error) {
            current = current.cause;
            continue;
        }
        if (typeof current === "object") {
            current = current.cause;
            continue;
        }
        break;
    }
    return undefined;
}
function readRetryAfterHeader(errorLike) {
    if (!errorLike || typeof errorLike !== "object")
        return undefined;
    const response = errorLike.response;
    if (!response || typeof response !== "object")
        return undefined;
    const headers = response.headers;
    if (!headers)
        return undefined;
    if (typeof headers.get === "function") {
        const raw = headers.get("retry-after");
        return parseRetryAfter(raw);
    }
    if (typeof headers === "object") {
        const raw = headers["retry-after"];
        if (typeof raw === "string") {
            return parseRetryAfter(raw);
        }
    }
    return undefined;
}
function parseRetryAfter(value) {
    if (!value)
        return undefined;
    const trimmed = value.trim();
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds))
        return seconds;
    const dateMs = Date.parse(trimmed);
    if (!Number.isNaN(dateMs)) {
        const deltaMs = dateMs - Date.now();
        if (deltaMs > 0)
            return Math.ceil(deltaMs / 1000);
    }
    return undefined;
}
function extractRateLimitPerMinute(error) {
    const message = extractErrorMessage(error);
    if (!message)
        return undefined;
    const match = message.match(/(\d+)\s*requests per minute/i);
    if (!match)
        return undefined;
    return Number(match[1]);
}
function extractErrorMessage(error) {
    const seen = new Set();
    let current = error;
    while (current && !seen.has(current)) {
        seen.add(current);
        if (current instanceof Error) {
            if (current.message)
                return current.message;
            current = current.cause;
            continue;
        }
        if (typeof current === "object") {
            const message = current.message;
            if (typeof message === "string")
                return message;
            current = current.cause;
            continue;
        }
        break;
    }
    return undefined;
}
function notifyRateLimitWait(modelId, waitSeconds, attempt) {
    const seconds = Math.max(1, Math.round(waitSeconds));
    const label = attempt === 1 ? "retry" : `retry ${attempt.toString()}`;
    console.warn(`[lgtm] rate limited by ${modelId}; waiting ${seconds}s before ${label}`);
}
function waitWithProgress(waitSeconds, verbose = false) {
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
function enterRateLimitGate() {
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
async function waitForRateLimitGate() {
    if (!rateLimitGate)
        return;
    await rateLimitGate;
}
async function maybeOfferModelSwitch(currentModel, waitSeconds) {
    if (!isInteractive() || modelSwitchDeclined) {
        return undefined;
    }
    const alternatives = await getAvailableAlternativeModels(currentModel);
    if (alternatives.length === 0) {
        return undefined;
    }
    if (!modelSwitchPrompt) {
        modelSwitchPrompt = promptForModelSwitch(currentModel, alternatives, waitSeconds).finally(() => {
            modelSwitchPrompt = undefined;
        });
    }
    return await modelSwitchPrompt;
}
async function promptForModelSwitch(currentModel, alternatives, waitSeconds) {
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
    const selectedModel = choice;
    modelOverride = selectedModel;
    console.warn(`[lgtm] switching model to ${MODEL_SPECS[selectedModel].label}`);
    return selectedModel;
}
async function getAvailableAlternativeModels(currentModel) {
    const hasAnthropic = await hasAnthropicApiKey();
    const hasOpenAI = await hasOpenAIApiKey();
    const hasGoogle = await hasGoogleApiKey();
    const isAvailable = (model) => {
        const provider = MODEL_SPECS[model].provider;
        if (provider === "anthropic")
            return hasAnthropic;
        if (provider === "openai")
            return hasOpenAI;
        if (provider === "google")
            return hasGoogle;
        return false;
    };
    const currentProvider = MODEL_SPECS[currentModel].provider;
    return Object.values(ModelChoice).filter((model) => {
        if (model === currentModel)
            return false;
        if (MODEL_SPECS[model].provider === currentProvider)
            return false;
        return isAvailable(model);
    });
}
function isInteractive() {
    return Boolean(process.stdin?.isTTY && process.stdout?.isTTY && !process.env.CI);
}
