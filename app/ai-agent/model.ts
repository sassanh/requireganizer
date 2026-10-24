import type { Model } from "@earendil-works/pi-ai";

export const DEFAULT_AI_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_AI_MODEL_ID = "nvidia/nemotron-3-ultra-550b-a55b:free";

/**
 * A model served by the configured OpenAI-compatible endpoint, for the pi
 * agent runtime. Requests use the Responses API with reasoning efforts
 * minimal/low/medium/high/xhigh.
 */
export function gatewayModel(id: string, baseUrl: string): Model<"openai-responses"> {
  return {
    id,
    name: id,
    api: "openai-responses",
    // The endpoint's host names the provider in provider-call records; pi-ai
    // also derives the provider's session header format from the URL.
    provider: new URL(baseUrl).hostname,
    baseUrl,
    reasoning: true,
    thinkingLevelMap: {
      off: null,
      minimal: "minimal",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: null,
    },
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_048_576,
    maxTokens: 131_072,
  };
}
