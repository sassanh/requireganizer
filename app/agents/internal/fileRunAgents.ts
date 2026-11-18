// Kept apart from runAgents.ts: it reads and writes files, which the page cannot.
import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import { parseRunAgents, type RunAgent, type RunAgentsSource } from "./runAgents";

function readStored(path: string): RunAgent[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  try {
    return parseRunAgents(JSON.parse(text));
  } catch {
    return [];
  }
}

/**
 * Agents kept in the file at `path`, such as a server's: one list for every
 * project, as a browser keeps one. Only the user can read the file, since it
 * holds the providers' keys.
 */
export function fileRunAgents(path: string): RunAgentsSource {
  let agents: readonly RunAgent[] = readStored(path);
  const listeners = new Set<() => void>();
  return {
    read: () => agents,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    save(next) {
      // Moved into place whole, so a process reading it never sees it half written.
      const draft = `${path}.${process.pid}`;
      writeFileSync(draft, JSON.stringify(next), { mode: 0o600 });
      chmodSync(draft, 0o600);
      renameSync(draft, path);
      agents = next;
      for (const listener of listeners) listener();
    },
  };
}
