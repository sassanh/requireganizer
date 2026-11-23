import type { Model } from "@earendil-works/pi-ai";

/**
 * A model served by an OpenAI-compatible endpoint, for the pi agent
 * runtime: requests use the Chat Completions API, which every
 * OpenAI-compatible endpoint serves.
 */
export function endpointModel(id: string, endpoint: string): Model<"openai-completions"> {
  return {
    id,
    name: id,
    api: "openai-completions",
    // The endpoint's host names the provider; pi-ai also reads what the endpoint accepts from it.
    provider: new URL(endpoint).hostname,
    baseUrl: endpoint,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_048_576,
    maxTokens: 131_072,
  };
}
