import { secrets } from "bun";
const SERVICE_NAME = "com.lgtm.cli";
// Anthropic API Key
export async function getAnthropicApiKey() {
    if (process.env.ANTHROPIC_API_KEY) {
        return process.env.ANTHROPIC_API_KEY;
    }
    return await secrets.get({
        service: SERVICE_NAME,
        name: "anthropic-api-key",
    });
}
export async function setAnthropicApiKey(apiKey) {
    await secrets.set({
        service: SERVICE_NAME,
        name: "anthropic-api-key",
        value: apiKey,
    });
}
export async function deleteAnthropicApiKey() {
    return await secrets.delete({
        service: SERVICE_NAME,
        name: "anthropic-api-key",
    });
}
export async function hasAnthropicApiKey() {
    const key = await getAnthropicApiKey();
    return key !== null;
}
// OpenAI API Key
export async function getOpenAIApiKey() {
    if (process.env.OPENAI_API_KEY) {
        return process.env.OPENAI_API_KEY;
    }
    return await secrets.get({
        service: SERVICE_NAME,
        name: "openai-api-key",
    });
}
export async function setOpenAIApiKey(apiKey) {
    await secrets.set({
        service: SERVICE_NAME,
        name: "openai-api-key",
        value: apiKey,
    });
}
export async function deleteOpenAIApiKey() {
    return await secrets.delete({
        service: SERVICE_NAME,
        name: "openai-api-key",
    });
}
export async function hasOpenAIApiKey() {
    const key = await getOpenAIApiKey();
    return key !== null;
}
// Google Gemini API Key
export async function getGoogleApiKey() {
    if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
        return process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    }
    return await secrets.get({
        service: SERVICE_NAME,
        name: "google-api-key",
    });
}
export async function setGoogleApiKey(apiKey) {
    await secrets.set({
        service: SERVICE_NAME,
        name: "google-api-key",
        value: apiKey,
    });
}
export async function deleteGoogleApiKey() {
    return await secrets.delete({
        service: SERVICE_NAME,
        name: "google-api-key",
    });
}
export async function hasGoogleApiKey() {
    const key = await getGoogleApiKey();
    return key !== null;
}
