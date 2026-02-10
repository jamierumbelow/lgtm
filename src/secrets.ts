import { secrets } from "bun";

const SERVICE_NAME = "com.lgtm.cli";

let _hasKeychain: boolean | null = null;

export async function hasKeychainSupport(): Promise<boolean> {
  if (_hasKeychain !== null) return _hasKeychain;
  try {
    await secrets.get({ service: SERVICE_NAME, name: "__lgtm_keychain_probe__" });
    _hasKeychain = true;
  } catch (e: any) {
    _hasKeychain = e?.code !== "ERR_SECRETS_PLATFORM_ERROR";
  }
  return _hasKeychain;
}

async function keychainGet(name: string): Promise<string | null> {
  if (!(await hasKeychainSupport())) return null;
  return await secrets.get({ service: SERVICE_NAME, name });
}

async function keychainSet(name: string, value: string): Promise<void> {
  if (!(await hasKeychainSupport())) {
    throw new Error("No system keychain available. Set API keys as environment variables instead.");
  }
  await secrets.set({ service: SERVICE_NAME, name, value });
}

async function keychainDelete(name: string): Promise<boolean> {
  if (!(await hasKeychainSupport())) return false;
  return await secrets.delete({ service: SERVICE_NAME, name });
}

// Anthropic API Key
export async function getAnthropicApiKey(): Promise<string | null> {
  return process.env.LGTM_ANTHROPIC_API_KEY
    ?? process.env.ANTHROPIC_API_KEY
    ?? await keychainGet("anthropic-api-key");
}

export async function setAnthropicApiKey(apiKey: string): Promise<void> {
  await keychainSet("anthropic-api-key", apiKey);
}

export async function deleteAnthropicApiKey(): Promise<boolean> {
  return await keychainDelete("anthropic-api-key");
}

export async function hasAnthropicApiKey(): Promise<boolean> {
  return (await getAnthropicApiKey()) !== null;
}

// OpenAI API Key
export async function getOpenAIApiKey(): Promise<string | null> {
  return process.env.LGTM_OPENAI_API_KEY
    ?? process.env.OPENAI_API_KEY
    ?? await keychainGet("openai-api-key");
}

export async function setOpenAIApiKey(apiKey: string): Promise<void> {
  await keychainSet("openai-api-key", apiKey);
}

export async function deleteOpenAIApiKey(): Promise<boolean> {
  return await keychainDelete("openai-api-key");
}

export async function hasOpenAIApiKey(): Promise<boolean> {
  return (await getOpenAIApiKey()) !== null;
}

// Google Gemini API Key
export async function getGoogleApiKey(): Promise<string | null> {
  return process.env.LGTM_GOOGLE_API_KEY
    ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY
    ?? await keychainGet("google-api-key");
}

export async function setGoogleApiKey(apiKey: string): Promise<void> {
  await keychainSet("google-api-key", apiKey);
}

export async function deleteGoogleApiKey(): Promise<boolean> {
  return await keychainDelete("google-api-key");
}

export async function hasGoogleApiKey(): Promise<boolean> {
  return (await getGoogleApiKey()) !== null;
}
