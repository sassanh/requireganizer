import type { Model } from "@earendil-works/pi-ai";

export const ZEN_BASE_URL = "https://opencode.ai/zen/v1";
export const ZEN_MODEL_ID = "x-preview-f-free";

/**
 * The OpenCode Zen gateway model definition for the pi agent runtime.
 *
 * The gateway only accepts reasoning efforts "low", "high", or "max", so the
 * thinking-level map constrains every level to one of those values. The base
 * URL is pinned again on the proxy server; this copy only describes the
 * endpoint to the browser.
 */
export const zenGatewayModel: Model<"openai-completions"> = {
  id: ZEN_MODEL_ID,
  name: "0x Alpha (OpenCode Zen)",
  api: "openai-completions",
  provider: "opencode-zen",
  baseUrl: ZEN_BASE_URL,
  reasoning: true,
  thinkingLevelMap: {
    off: null,
    minimal: "low",
    low: "low",
    medium: "high",
    high: "high",
    xhigh: "max",
    max: "max",
  },
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 32_000,
  compat: {
    supportsStore: false,
    // The Zen gateway hangs on stream_options:{include_usage:true}; it always
    // reports usage on the final chunk anyway.
    supportsUsageInStreaming: false,
  },
};
