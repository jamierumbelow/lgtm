import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { z, ZodFirstPartyTypeKind } from "zod";

const PROMPT_CACHE_DIR = join(homedir(), ".cache", "lgtm", "prompts");

function ensurePromptCacheDir(): void {
  if (!existsSync(PROMPT_CACHE_DIR)) {
    mkdirSync(PROMPT_CACHE_DIR, { recursive: true });
  }
}

function getPromptCachePath(key: string): string {
  return join(PROMPT_CACHE_DIR, `${key}.json`);
}

export function getSchemaSignature(schema: z.ZodTypeAny): string {
  const def = schema._def as { typeName?: string };
  if (def.typeName === ZodFirstPartyTypeKind.ZodObject) {
    const shape = (schema as z.ZodObject<any>).shape;
    const keys = Object.keys(shape).sort();
    return `object:${keys.join(",")}`;
  }
  return def.typeName ?? "unknown";
}

export function createPromptCacheKey(input: {
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  schemaSignature: string;
  temperature: number;
  maxTokens: number;
}): string {
  const payload = JSON.stringify(input);
  return createHash("sha256").update(payload).digest("hex");
}

export function getCachedPromptResponse<T>(key: string): T | null {
  ensurePromptCacheDir();
  const cachePath = getPromptCachePath(key);
  if (!existsSync(cachePath)) {
    return null;
  }

  try {
    const raw = readFileSync(cachePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setCachedPromptResponse<T>(key: string, value: T): void {
  ensurePromptCacheDir();
  const cachePath = getPromptCachePath(key);
  try {
    writeFileSync(cachePath, JSON.stringify(value, null, 2));
  } catch (error) {
    console.error(`[lgtm] Failed to write prompt cache to ${cachePath}:`, error);
  }
}
