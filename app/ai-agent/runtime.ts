import type { StreamFn } from "@earendil-works/pi-agent-core";

import { installGateway } from "./gateway";
import { type AiSettingsSource, configureAiSettings } from "./settings";

/**
 * The provider client, loaded with the first model call: the page loads
 * without it, and prerendering never evaluates it.
 */
const providerRequest: StreamFn = async (model, context, options) => {
  const { streamSimple } = await import("@earendil-works/pi-ai/compat");
  return streamSimple(model, context, options);
};

/**
 * Make this process's agents call the configured endpoint. A project host's
 * composition root calls it once, before any agent runs.
 */
export function installAiRuntime(settings: AiSettingsSource): void {
  configureAiSettings(settings);
  installGateway(providerRequest);
}
