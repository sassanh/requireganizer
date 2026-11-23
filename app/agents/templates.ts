import { isRecord } from "lib/json";

/**
 * What the spec owner keeps to start internal agents from: a name, the
 * OpenAI-compatible endpoint of an AI provider, a key for that endpoint and
 * a model. An internal agent uses what its template has at the time.
 */
export interface Template {
  id: string;
  name: string;
  endpoint: string;
  /** Empty when none is set. */
  key: string;
  model: string;
}

/** A template as the spec owner writes it. */
export type TemplateDraft = Omit<Template, "id">;

/** A template as the page sees it: its key never leaves the host. */
export interface TemplateView {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  hasKey: boolean;
}

export const templateView = ({ key, ...template }: Template): TemplateView => ({ ...template, hasKey: key.length > 0 });

/**
 * Where the spec owner's templates are kept: the page's browser storage when
 * the host runs in the page, a file of the user's otherwise. They are the
 * spec owner's, not a project's, since they hold the providers' keys.
 */
export interface TemplatesSource {
  read(): readonly Template[];
  subscribe(listener: () => void): () => void;
  /** Throws when the templates cannot be kept. */
  save(templates: readonly Template[]): void;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Why a template cannot be kept as written, one line per field; empty when it can. */
export function templateProblems(template: TemplateDraft): string[] {
  return [
    ...(template.name.trim().length === 0 ? ["Give the template a name."] : []),
    ...(isHttpUrl(template.endpoint.trim()) ? [] : [`${JSON.stringify(template.endpoint)} is not an http or https URL. Give the address of the AI provider's OpenAI-compatible endpoint.`]),
    ...(template.model.trim().length === 0 ? ["Give the model the template uses."] : []),
  ];
}

/** The templates a stored value holds. */
export function parseTemplates(value: unknown): Template[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): Template[] => {
    if (!isRecord(entry)) return [];
    const { id, name, endpoint, key, model } = entry;
    if (typeof id !== "string" || typeof name !== "string" || typeof endpoint !== "string" || typeof key !== "string" || typeof model !== "string") return [];
    return [{ id, name, endpoint, key, model }];
  });
}

const TEMPLATES_KEY = "requireganizer:templates";

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Templates kept in this browser, for a host that runs in the page. */
export function browserTemplates(): TemplatesSource {
  const listeners = new Set<() => void>();
  let readText: string | null | undefined;
  let readTemplates: readonly Template[] = [];
  return {
    read() {
      const text = browserStorage()?.getItem(TEMPLATES_KEY) ?? null;
      // The same stored text reads as the same list, for subscribers that compare snapshots.
      if (text !== readText) {
        readText = text;
        try {
          readTemplates = parseTemplates(text == null ? [] : JSON.parse(text));
        } catch {
          readTemplates = [];
        }
      }
      return readTemplates;
    },
    subscribe(listener) {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key === TEMPLATES_KEY) listener();
      };
      if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
      };
    },
    save(templates) {
      const storage = browserStorage();
      if (storage == null) throw new Error("Browser storage is unavailable, so the templates cannot be kept.");
      storage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
      for (const listener of listeners) listener();
    },
  };
}
