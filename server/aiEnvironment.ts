import { type AiSettingsSource, fixedAiSettings, readAiSettings } from "ai-agent/settings";

/**
 * The AI settings a server reads from its environment when it starts.
 * Throws when AI_BASE_URL is set to something that is not a URL, so the
 * server does not start with an endpoint every request would fail on.
 */
export function environmentAiSettings(
  environment: Record<string, string | undefined> = process.env,
): AiSettingsSource {
  const { settings, invalidBaseUrl } = readAiSettings({
    baseUrl: environment.AI_BASE_URL,
    apiKey: environment.AI_API_KEY,
    model: environment.AI_MODEL,
    reviewerModel: environment.AI_REVIEWER_MODEL,
  });
  if (invalidBaseUrl != null) {
    throw new Error(
      `AI_BASE_URL is "${invalidBaseUrl}", which is not an http or https URL. Set it to one, such as ${settings.baseUrl}.`,
    );
  }
  return fixedAiSettings(settings, {
    missingApiKeyMessage:
      "Set AI_API_KEY where the Requireganizer server runs, then restart it.",
    missingReviewerModelMessage:
      "Set AI_REVIEWER_MODEL where the Requireganizer server runs, then restart it, to use auto review.",
  });
}
