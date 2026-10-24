import {
  configureAiSettings,
  DEFAULT_AI_SETTINGS,
  fixedAiSettings,
} from "../../app/ai-agent/settings";

/** Configure a reviewer model for the importing test file. */
configureAiSettings(
  fixedAiSettings(
    { ...DEFAULT_AI_SETTINGS, apiKey: "test-key", reviewerModel: "reviewer-model" },
    {
      missingApiKeyMessage: "No API key is configured for the AI endpoint.",
      missingReviewerModelMessage: "No reviewer model is configured.",
    },
  ),
);

export {};
