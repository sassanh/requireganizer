import type { StreamFn } from "@earendil-works/pi-agent-core";

import { UserFacingError } from "lib/errors";

import type { Template } from "../templates";
import { endpointModel } from "./model";

/**
 * The provider client, loaded with the first model call: the page loads
 * without it, and prerendering never evaluates it.
 */
const providerRequest: StreamFn = async (model, context, options) => {
  const { streamSimple } = await import("@earendil-works/pi-ai/compat");
  return streamSimple(model, context, options);
};

/**
 * The stream an internal agent calls its AI provider on, from wherever the
 * project host runs: each request reaches the endpoint, with the key and the
 * model, that the agent's template has at the time of the request.
 */
export function templateStream(templateNow: () => Template): StreamFn {
  return (_model, context, options) => {
    const template = templateNow();
    if (template.key.length === 0) throw new UserFacingError(`The template ${template.name} has no key for its endpoint. Add one to the template.`);
    return providerRequest(endpointModel(template.model, template.endpoint), context, { ...options, apiKey: template.key });
  };
}
