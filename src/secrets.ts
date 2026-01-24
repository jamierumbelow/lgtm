import { secrets } from 'bun';

const SERVICE_NAME = 'com.lgtm.cli';

export async function getAnthropicApiKey(): Promise<string | null> {
  // First check environment variable (for CI/production)
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }

  // Then check secure storage
  return await secrets.get({
    service: SERVICE_NAME,
    name: 'anthropic-api-key',
  });
}

export async function setAnthropicApiKey(apiKey: string): Promise<void> {
  await secrets.set({
    service: SERVICE_NAME,
    name: 'anthropic-api-key',
    value: apiKey,
  });
}

export async function deleteAnthropicApiKey(): Promise<boolean> {
  return await secrets.delete({
    service: SERVICE_NAME,
    name: 'anthropic-api-key',
  });
}

export async function hasAnthropicApiKey(): Promise<boolean> {
  const key = await getAnthropicApiKey();
  return key !== null;
}
