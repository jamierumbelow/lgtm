import { secrets } from "bun";

const SERVICE_NAME = "com.lgtm.cli";

// Anthropic API Key
export async function getAnthropicApiKey(): Promise<string | null> {
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }
  return await secrets.get({
    service: SERVICE_NAME,
    name: "anthropic-api-key",
  });
}

export async function setAnthropicApiKey(apiKey: string): Promise<void> {
  await secrets.set({
    service: SERVICE_NAME,
    name: "anthropic-api-key",
    value: apiKey,
  });
}

export async function deleteAnthropicApiKey(): Promise<boolean> {
  return await secrets.delete({
    service: SERVICE_NAME,
    name: "anthropic-api-key",
  });
}

export async function hasAnthropicApiKey(): Promise<boolean> {
  const key = await getAnthropicApiKey();
  return key !== null;
}

// OpenAI API Key
export async function getOpenAIApiKey(): Promise<string | null> {
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }
  return await secrets.get({
    service: SERVICE_NAME,
    name: "openai-api-key",
  });
}

export async function setOpenAIApiKey(apiKey: string): Promise<void> {
  await secrets.set({
    service: SERVICE_NAME,
    name: "openai-api-key",
    value: apiKey,
  });
}

export async function deleteOpenAIApiKey(): Promise<boolean> {
  return await secrets.delete({
    service: SERVICE_NAME,
    name: "openai-api-key",
  });
}

export async function hasOpenAIApiKey(): Promise<boolean> {
  const key = await getOpenAIApiKey();
  return key !== null;
}

// Google Gemini API Key
export async function getGoogleApiKey(): Promise<string | null> {
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  }
  return await secrets.get({
    service: SERVICE_NAME,
    name: "google-api-key",
  });
}

export async function setGoogleApiKey(apiKey: string): Promise<void> {
  await secrets.set({
    service: SERVICE_NAME,
    name: "google-api-key",
    value: apiKey,
  });
}

export async function deleteGoogleApiKey(): Promise<boolean> {
  return await secrets.delete({
    service: SERVICE_NAME,
    name: "google-api-key",
  });
}

export async function hasGoogleApiKey(): Promise<boolean> {
  const key = await getGoogleApiKey();
  return key !== null;
}
