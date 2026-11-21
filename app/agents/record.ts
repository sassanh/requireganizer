import { isRecord } from "lib/json";

/**
 * How a thread stopped waiting for an agent, and when: answered by the agent
 * that had it, whose reply in the thread says which agent it was; withdrawn
 * by the spec owner; ended by the resolution of the thread; or set waiting
 * anew by a later message of the spec owner's in the thread.
 */
export interface WaitEnd {
  how: "answered" | "withdrawn" | "resolved" | "set waiting anew";
  at: string;
}

/** One thing an agent Requireganizer runs did while it had a thread: a call through the agent interface, or the reasoning its AI provider disclosed. */
export type RunLogEntry =
  | { kind: "call"; at: string; tool: string; sent: unknown; got: string; refused: boolean }
  | { kind: "reasoning"; at: string; text: string };

/** What one agent Requireganizer runs did while it had a thread, from when it was assigned to it until it no longer had it. */
export interface RunLog {
  agent: string;
  from: string;
  /** Null while the agent still has the thread. */
  until: string | null;
  entries: RunLogEntry[];
}

/**
 * One wait of a thread for an agent, as the Agents module keeps it beside
 * the project: the spec owner's message that set the thread waiting, how
 * the wait ended, and the run logs of the agents Requireganizer runs that
 * had the thread meanwhile. Undo, redo and going to a step never move it;
 * only whether its message is in the project decides whether it can still
 * wait.
 */
export interface WaitRecord {
  id: string;
  moduleId: string;
  threadId: string;
  messageId: string;
  since: string;
  ended: WaitEnd | null;
  runLogs: RunLog[];
}

const text = (value: unknown): value is string => typeof value === "string";

function endOf(value: unknown): WaitEnd | null {
  if (!isRecord(value) || !text(value.at)) return null;
  return value.how === "answered" || value.how === "withdrawn" || value.how === "resolved" || value.how === "set waiting anew" ? { how: value.how, at: value.at } : null;
}

function entryOf(value: unknown): RunLogEntry | null {
  if (!isRecord(value) || !text(value.at)) return null;
  if (value.kind === "reasoning") return text(value.text) ? { kind: "reasoning", at: value.at, text: value.text } : null;
  if (value.kind === "call" && text(value.tool) && text(value.got) && typeof value.refused === "boolean") {
    return { kind: "call", at: value.at, tool: value.tool, sent: value.sent ?? null, got: value.got, refused: value.refused };
  }
  return null;
}

function runLogOf(value: unknown): RunLog | null {
  if (!isRecord(value) || !text(value.agent) || !text(value.from) || (value.until !== null && !text(value.until)) || !Array.isArray(value.entries)) return null;
  return { agent: value.agent, from: value.from, until: value.until, entries: value.entries.flatMap((entry) => entryOf(entry) ?? []) };
}

/** The waits the project's record keeps; an entry that cannot be read is left out. */
export function parseWaitRecords(value: unknown): WaitRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): WaitRecord[] => {
    if (!isRecord(entry) || !text(entry.id) || !text(entry.moduleId) || !text(entry.threadId) || !text(entry.messageId) || !text(entry.since)) return [];
    if (entry.ended !== null && endOf(entry.ended) == null) return [];
    return [
      {
        id: entry.id,
        moduleId: entry.moduleId,
        threadId: entry.threadId,
        messageId: entry.messageId,
        since: entry.since,
        ended: endOf(entry.ended),
        runLogs: Array.isArray(entry.runLogs) ? entry.runLogs.flatMap((log) => runLogOf(log) ?? []) : [],
      },
    ];
  });
}
