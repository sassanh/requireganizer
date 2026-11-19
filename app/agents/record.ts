import { isRecord } from "lib/json";

/**
 * How a request stopped waiting, and when: answered by the agent that had
 * it, whose reply in the thread says which agent it was; withdrawn by the
 * spec owner; ended by the resolution of its thread; or made anew by a later
 * message of the spec owner's in its thread.
 */
export interface RequestEnd {
  how: "answered" | "withdrawn" | "resolved" | "made anew";
  at: string;
}

/** One thing an agent Requireganizer runs did while it had a request: a call through the agent interface, or the reasoning its AI provider disclosed. */
export type RunLogEntry =
  | { kind: "call"; at: string; tool: string; sent: unknown; got: string; refused: boolean }
  | { kind: "reasoning"; at: string; text: string };

/** What one agent Requireganizer runs did while it had a request, from when it was given to it until it no longer had it. */
export interface RunLog {
  agent: string;
  from: string;
  /** Null while the agent still has the request. */
  until: string | null;
  entries: RunLogEntry[];
}

/**
 * A request of the spec owner's to an agent, as the Agents module keeps it
 * beside the project: the message that made it, how it ended, and the run
 * logs of the agents Requireganizer runs that had it. Undo, redo and going
 * to a step never move it; only whether its message is in the project
 * decides whether it can still wait.
 */
export interface RequestRecord {
  id: string;
  moduleId: string;
  threadId: string;
  messageId: string;
  madeAt: string;
  ended: RequestEnd | null;
  runLogs: RunLog[];
}

const text = (value: unknown): value is string => typeof value === "string";

function endOf(value: unknown): RequestEnd | null {
  if (!isRecord(value) || !text(value.at)) return null;
  return value.how === "answered" || value.how === "withdrawn" || value.how === "resolved" || value.how === "made anew" ? { how: value.how, at: value.at } : null;
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

/** The requests the project's record keeps; an entry that cannot be read is left out. */
export function parseRequestRecords(value: unknown): RequestRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): RequestRecord[] => {
    if (!isRecord(entry) || !text(entry.id) || !text(entry.moduleId) || !text(entry.threadId) || !text(entry.messageId) || !text(entry.madeAt)) return [];
    if (entry.ended !== null && endOf(entry.ended) == null) return [];
    return [
      {
        id: entry.id,
        moduleId: entry.moduleId,
        threadId: entry.threadId,
        messageId: entry.messageId,
        madeAt: entry.madeAt,
        ended: endOf(entry.ended),
        runLogs: Array.isArray(entry.runLogs) ? entry.runLogs.flatMap((log) => runLogOf(log) ?? []) : [],
      },
    ];
  });
}
