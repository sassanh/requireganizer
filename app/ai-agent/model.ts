import type { Model } from "@earendil-works/pi-ai";

export const ZEN_BASE_URL = "https://opencode.ai/zen/v1";
export const ZEN_MODEL_ID = "muse-spark-1.3-contributor-free";

/**
 * The OpenCode Zen gateway model definition for the pi agent runtime.
 *
 * Muse Spark via the Zen gateway uses the Responses API with reasoning
 * efforts minimal/low/medium/high/xhigh. The base URL is pinned again on
 * the proxy server; this copy only describes the endpoint to the browser.
 */
export const zenGatewayModel: Model<"openai-responses"> = {
  id: ZEN_MODEL_ID,
  name: "Muse Spark 1.3 (Free)",
  api: "openai-responses",
  provider: "opencode",
  baseUrl: ZEN_BASE_URL,
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
  compat: {
    sessionAffinityFormat: "openai-nosession",
  },
};
