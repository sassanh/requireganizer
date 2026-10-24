import type { Model } from "@earendil-works/pi-ai";

import { DEFAULT_AI_BASE_URL, DEFAULT_AI_MODEL_ID, gatewayModel } from "./model";

/** The AI endpoint a project host calls, and the models it uses there. */
export interface AiSettings {
  /** Base URL of an OpenAI-compatible Responses API. */
  baseUrl: string;
  /** Bearer credential for the endpoint; empty when none is set. */
  apiKey: string;
  /** The writer model's id. */
  model: string;
  /** The reviewer model's id on the same endpoint; null for manual review only. */
  reviewerModel: string | null;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  baseUrl: DEFAULT_AI_BASE_URL,
  apiKey: "",
  model: DEFAULT_AI_MODEL_ID,
  reviewerModel: null,
};

/** Whether a value names an http or https endpoint. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * The AI settings that stored or configured values give: text is trimmed,
 * an empty or missing value takes its default, and a base URL that is not an
 * http or https URL is reported instead of used. Every settings source reads
 * its values through here.
 */
export function readAiSettings(
  values: Partial<Record<keyof AiSettings, unknown>>,
): { settings: AiSettings; invalidBaseUrl: string | null } {
  const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  const baseUrl = text(values.baseUrl);
  const invalidBaseUrl = baseUrl != null && !isHttpUrl(baseUrl) ? baseUrl : null;
  return {
    settings: {
      baseUrl: (invalidBaseUrl == null ? baseUrl : null) ?? DEFAULT_AI_SETTINGS.baseUrl,
      apiKey: text(values.apiKey) ?? "",
      model: text(values.model) ?? DEFAULT_AI_SETTINGS.model,
      reviewerModel: text(values.reviewerModel),
    },
    invalidBaseUrl,
  };
}

/**
 * Where a project host reads its AI settings. Each deployment has one: the
 * page's own settings when the host runs in the browser, the environment
 * when it runs in a server. The messages tell the user how to change a
 * setting there.
 */
export interface AiSettingsSource {
  read(): AiSettings;
  subscribe(listener: () => void): () => void;
  readonly missingApiKeyMessage: string;
  readonly missingReviewerModelMessage: string;
}

/** Settings that never change, such as a server's environment. */
export function fixedAiSettings(
  settings: AiSettings,
  messages: Pick<AiSettingsSource, "missingApiKeyMessage" | "missingReviewerModelMessage">,
): AiSettingsSource {
  return {
    read: () => settings,
    subscribe: () => () => {},
    ...messages,
  };
}

let source: AiSettingsSource = fixedAiSettings(DEFAULT_AI_SETTINGS, {
  missingApiKeyMessage: "No API key is configured for the AI endpoint.",
  missingReviewerModelMessage: "No reviewer model is configured, so auto review is unavailable.",
});

/** Set where this process reads its AI settings; called once by the composition root. */
export function configureAiSettings(next: AiSettingsSource): void {
  source = next;
}

export function aiSettings(): AiSettingsSource {
  return source;
}

/** The model the conversation agent writes with. */
export function writerModel(settings: AiSettings = source.read()): Model<"openai-responses"> {
  return gatewayModel(settings.model, settings.baseUrl);
}

/** The reviewer model, or null when none is configured. */
export function reviewerModel(
  settings: AiSettings = source.read(),
): Model<"openai-responses"> | null {
  return settings.reviewerModel == null
    ? null
    : gatewayModel(settings.reviewerModel, settings.baseUrl);
}
