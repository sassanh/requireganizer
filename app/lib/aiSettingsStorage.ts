import {
  type AiSettings,
  type AiSettingsSource,
  DEFAULT_AI_SETTINGS,
  readAiSettings,
} from "ai-agent/settings";

import { isRecord } from "./json";

const AI_SETTINGS_KEY = "requireganizer:ai-settings";

function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Stored settings, with defaults for anything missing or malformed. */
export function parseStoredAiSettings(source: string | null): AiSettings {
  let stored: unknown = null;
  try {
    stored = source == null ? null : JSON.parse(source);
  } catch {
    stored = null;
  }
  return isRecord(stored) ? readAiSettings(stored).settings : DEFAULT_AI_SETTINGS;
}

/** The settings a person entered in this browser. */
export interface BrowserAiSettings extends AiSettingsSource {
  /** Throws when browser storage is unavailable or full. */
  save(settings: AiSettings): void;
}

export function createBrowserAiSettings(): BrowserAiSettings {
  const listeners = new Set<() => void>();
  let readSource: string | null | undefined;
  let readSettings = DEFAULT_AI_SETTINGS;
  const notify = () => listeners.forEach((listener) => listener());
  return {
    read() {
      const source = getBrowserStorage()?.getItem(AI_SETTINGS_KEY) ?? null;
      // The same stored text reads as the same object, for subscribers that
      // compare snapshots.
      if (source !== readSource) {
        readSource = source;
        readSettings = parseStoredAiSettings(source);
      }
      return readSettings;
    },
    subscribe(listener) {
      listeners.add(listener);
      // Another tab's save reaches this tab as a storage event.
      const onStorage = (event: StorageEvent) => {
        if (event.key === AI_SETTINGS_KEY) listener();
      };
      if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
      };
    },
    save(settings) {
      const storage = getBrowserStorage();
      if (storage == null) throw new Error("Browser storage is unavailable, so the settings cannot be saved.");
      storage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
      notify();
    },
    missingApiKeyMessage: "Add an API key in AI settings.",
    missingReviewerModelMessage: "Choose a reviewer model in AI settings to use auto review.",
  };
}

/** This page's AI settings, read by the project host the page runs. */
export const browserAiSettings = createBrowserAiSettings();
