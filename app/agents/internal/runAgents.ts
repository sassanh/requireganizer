import { isRecord } from "lib/json";

/** Whether a value names an http or https address. */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** The AI provider an agent Requireganizer runs calls: an OpenAI-compatible Responses API and its key. */
export interface AiProvider {
  baseUrl: string;
  /** Empty when none is set. */
  apiKey: string;
}

/** An agent Requireganizer runs, as the spec owner set it up. */
export interface RunAgent {
  id: string;
  name: string;
  provider: AiProvider;
  model: string;
}

/**
 * Where the agents Requireganizer runs are kept: the page's browser storage
 * when the host runs in the page, a file of the user's otherwise. Every
 * change goes through `save`, which the roster checks names against first.
 */
export interface RunAgentsSource {
  read(): readonly RunAgent[];
  subscribe(listener: () => void): () => void;
  /** Throws when the agents cannot be kept. */
  save(agents: readonly RunAgent[]): void;
}

/** Why an agent cannot be kept as given, one line per field; empty when it can. */
export function runAgentProblems(agent: Omit<RunAgent, "id">): string[] {
  return [
    ...(isHttpUrl(agent.provider.baseUrl) ? [] : [`${JSON.stringify(agent.provider.baseUrl)} is not an http or https URL. Give the AI provider's address.`]),
    ...(agent.model.trim().length === 0 ? ["Give the model the agent uses."] : []),
  ];
}

/** The agents a stored value holds; an entry that cannot be read is left out. */
export function parseRunAgents(value: unknown): RunAgent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): RunAgent[] => {
    if (!isRecord(entry) || !isRecord(entry.provider)) return [];
    const { id, name, model } = entry;
    const { baseUrl, apiKey } = entry.provider;
    if (typeof id !== "string" || typeof name !== "string" || typeof model !== "string" || typeof baseUrl !== "string") return [];
    return [{ id, name, model, provider: { baseUrl, apiKey: typeof apiKey === "string" ? apiKey : "" } }];
  });
}

const RUN_AGENTS_KEY = "requireganizer:agents";

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Agents kept in this browser, for a host that runs in the page. */
export function browserRunAgents(): RunAgentsSource {
  const listeners = new Set<() => void>();
  let readText: string | null | undefined;
  let readAgents: readonly RunAgent[] = [];
  return {
    read() {
      const text = browserStorage()?.getItem(RUN_AGENTS_KEY) ?? null;
      // The same stored text reads as the same list, for subscribers that compare snapshots.
      if (text !== readText) {
        readText = text;
        try {
          readAgents = parseRunAgents(text == null ? [] : JSON.parse(text));
        } catch {
          readAgents = [];
        }
      }
      return readAgents;
    },
    subscribe(listener) {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key === RUN_AGENTS_KEY) listener();
      };
      if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
      };
    },
    save(agents) {
      const storage = browserStorage();
      if (storage == null) throw new Error("Browser storage is unavailable, so the agents cannot be kept.");
      storage.setItem(RUN_AGENTS_KEY, JSON.stringify(agents));
      for (const listener of listeners) listener();
    },
  };
}
