// Kept apart from sessions.ts: it reads and writes files, which the page cannot.
import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import { isRecord } from "lib/json";

import type { SessionsSource } from "../sessions";

function readStored(path: string): Map<string, string> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) return new Map();
    return new Map(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return new Map();
  }
}

/**
 * Session ids kept in the file at `path` on this computer, one map for
 * every project, by their hashes. Only the user can read the file, since a
 * session id resumes that session.
 */
export function fileSessions(path: string): SessionsSource {
  const ids = readStored(path);
  return {
    idOf: (hash) => ids.get(hash) ?? null,
    remember(hash, id) {
      if (ids.get(hash) === id) return;
      ids.set(hash, id);
      // Moved into place whole, so a process reading it never sees it half written.
      const draft = `${path}.${process.pid}`;
      writeFileSync(draft, JSON.stringify(Object.fromEntries(ids)), { mode: 0o600 });
      chmodSync(draft, 0o600);
      renameSync(draft, path);
    },
  };
}
