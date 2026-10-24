import type { StreamFn } from "@earendil-works/pi-agent-core";

import { UserFacingError } from "lib/errors";

import { fetchWithReasoningTextBridge } from "./reasoning-sse";
import { aiSettings } from "./settings";

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
 * A stream that calls the model's endpoint directly from wherever the
 * project host runs, with the API key configured when each request starts,
 * through `request`, the provider client that sends the request.
 */
export function createGatewayStream(request: StreamFn): StreamFn {
  return (model, context, options) =>
    request(model, context, {
      ...options,
      apiKey: aiSettings().read().apiKey,
      fetch: fetchWithReasoningTextBridge,
      onPayload: withDetailedReasoningSummary,
    });
}

let installed: StreamFn | null = null;

/** Set the provider client agents call; done once by the AI runtime. */
export function installGateway(request: StreamFn): void {
  installed = createGatewayStream(request);
}

/**
 * The stream agents run on when they are given none. Without an API key no
 * turn starts: the person is told where to add one, and nothing is recorded
 * as an attempt.
 */
export function gatewayStream(): StreamFn {
  if (installed == null) {
    throw new Error("The AI runtime is not installed, so no model can be called.");
  }
  const settings = aiSettings();
  if (settings.read().apiKey.length === 0) {
    throw new UserFacingError(settings.missingApiKeyMessage);
  }
  return installed;
}
