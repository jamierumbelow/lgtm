import { generateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '../../prompts');

export function loadPrompt(promptPath: string): string {
  const fullPath = join(PROMPTS_DIR, promptPath);
  return readFileSync(fullPath, 'utf-8');
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

export async function generateStructured<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: import('zod').ZodType<T>,
  options: LLMOptions = {}
): Promise<T> {
  const { model = DEFAULT_MODEL, temperature = 0.2, maxTokens = 4096 } = options;

  const result = await generateObject({
    model: anthropic(model),
    system: systemPrompt,
    prompt: userPrompt,
    schema,
    temperature,
    maxTokens,
  });

  return result.object;
}
