import type { StreamFn } from "@earendil-works/pi-agent-core";

import { UserFacingError } from "lib/errors";

import { fetchWithReasoningTextBridge } from "./reasoning-sse";

/** Ask for detailed reasoning summaries wherever the request asks for reasoning. */
function withDetailedReasoningSummary(payload: unknown): unknown {
  if (payload == null || typeof payload !== "object") return undefined;
  const params = payload as Record<string, unknown>;
  if (params.reasoning == null || typeof params.reasoning !== "object") {
    return undefined;
  }
  return {
    ...params,
    reasoning: {
      ...(params.reasoning as Record<string, unknown>),
      summary: "detailed",
    },
  };
}

/**
 * The provider client, loaded with the first model call: the page loads
 * without it, and prerendering never evaluates it.
 */
const providerRequest: StreamFn = async (model, context, options) => {
  const { streamSimple } = await import("@earendil-works/pi-ai/compat");
  return streamSimple(model, context, options);
};

/**
 * The stream an agent Requireganizer runs calls its AI provider on, from
 * wherever the project host runs, with that provider's API key.
 */
export function providerStream(apiKey: string): StreamFn {
  if (apiKey.length === 0) throw new UserFacingError("The agent's AI provider has no API key. Add one to the agent.");
  return (model, context, options) =>
    providerRequest(model, context, {
      ...options,
      apiKey,
      fetch: fetchWithReasoningTextBridge,
      onPayload: withDetailedReasoningSummary,
    });
}
