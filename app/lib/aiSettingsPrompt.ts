/**
 * Whether the browser build should open AI settings because it has no API
 * key. The page build calls AI endpoints itself, so no server can supply one
 * and the person has to add it where the page keeps its settings.
 */
export function needsAiSettingsPrompt(
  location: "page" | "server",
  apiKey: string,
): boolean {
  return location === "page" && apiKey.trim().length === 0;
}
