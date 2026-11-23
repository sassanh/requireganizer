import type { AgentId } from "agents/record";
import { isRecord } from "lib/json";
import type { ItemVersion } from "workflow";

/**
 * How a thread stopped waiting for an agent: answered by the agent that had
 * it, withdrawn by the spec owner, resolved by them, or set waiting anew by
 * a later message of theirs.
 */
export type WaitEnd = "answered" | "withdrawn" | "resolved" | "set waiting anew";

/** One wait of a thread for an agent: from a message of the spec owner's in it until it ends. */
export interface Wait {
  id: string;
  moduleId: string;
  threadId: string;
  /** The spec owner's message that set the thread waiting. */
  messageId: string;
  since: string;
  ended: { how: WaitEnd; at: string } | null;
}

/** How an agent's assignment to a thread ended. */
export type AssignmentEnd = "replied" | "failed" | "stopped" | "archived";

/**
 * A thread handed to one agent, from when the spec owner assigned it until
 * the agent replies, fails, is stopped or is archived. It goes on through
 * every wait of the thread meanwhile. Its id is what the agent passes back.
 */
export interface Assignment {
  id: string;
  moduleId: string;
  threadId: string;
  agentId: AgentId;
  since: string;
  until: string | null;
  end: AssignmentEnd | null;
}

/** Why an agent failed to answer a thread, shown until the thread is assigned again. */
export interface Failure {
  agentId: AgentId;
  why: string;
  at: string;
}

/** An item version an agent wrote, by the item and the version's revision. */
export interface Written {
  itemId: string;
  revision: string;
  agentId: AgentId;
}

/** One item change an agent's reply made: the item, its kind, and its version before and after; null where there is none. */
export interface ReplyChange {
  itemId: string;
  kind: string;
  before: ItemVersion | null;
  after: ItemVersion | null;
}

/** A thread of a module, as Delegation keys what it keeps of it. */
export interface ThreadPlace {
  moduleId: string;
  threadId: string;
}

/**
 * What the Delegation module keeps beside a project, apart from its history:
 * no undo, redo or step gone to changes whether a thread waits or which
 * agent has it.
 */
export interface DelegationRecord {
  waits: Wait[];
  assignments: Assignment[];
  /** By thread key. */
  failures: Record<string, Failure>;
  /** The agent of each module that has one, by module id. */
  moduleAgents: Record<string, AgentId>;
  writers: Written[];
  /** The thread each internal agent was started in, for those started for a thread. */
  startedIn: Record<AgentId, ThreadPlace>;
  /** The item changes each reply sent with changes made, by the reply's message id. */
  replyChanges: Record<string, ReplyChange[]>;
}

export const EMPTY_RECORD: DelegationRecord = { waits: [], assignments: [], failures: {}, moduleAgents: {}, writers: [], startedIn: {}, replyChanges: {} };

/** The key of a thread among every module's. */
export const threadKey = ({ moduleId, threadId }: ThreadPlace): string => `${moduleId}/${threadId}`;

const text = (value: unknown): value is string => typeof value === "string";
const textOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
const WAIT_ENDS: readonly WaitEnd[] = ["answered", "withdrawn", "resolved", "set waiting anew"];
const ASSIGNMENT_ENDS: readonly AssignmentEnd[] = ["replied", "failed", "stopped", "archived"];

function waitOf(value: unknown): Wait | null {
  if (!isRecord(value) || !text(value.id) || !text(value.moduleId) || !text(value.threadId) || !text(value.messageId) || !text(value.since)) return null;
  const ended = value.ended;
  if (ended !== null && (!isRecord(ended) || !text(ended.at) || !WAIT_ENDS.includes(ended.how as WaitEnd))) return null;
  return { id: value.id, moduleId: value.moduleId, threadId: value.threadId, messageId: value.messageId, since: value.since, ended: ended == null ? null : { how: ended.how as WaitEnd, at: ended.at as string } };
}

function assignmentOf(value: unknown): Assignment | null {
  if (!isRecord(value) || !text(value.id) || !text(value.moduleId) || !text(value.threadId) || !text(value.agentId) || !text(value.since) || !textOrNull(value.until)) return null;
  if (value.end !== null && !ASSIGNMENT_ENDS.includes(value.end as AssignmentEnd)) return null;
  return { id: value.id, moduleId: value.moduleId, threadId: value.threadId, agentId: value.agentId, since: value.since, until: value.until, end: value.end as AssignmentEnd | null };
}

function versionOf(value: unknown): ItemVersion | null {
  if (!isRecord(value) || !isRecord(value.content) || !Array.isArray(value.references) || !Array.isArray(value.dependencies)) return null;
  return value as unknown as ItemVersion;
}

function replyChangeOf(value: unknown): ReplyChange | null {
  if (!isRecord(value) || !text(value.itemId) || !text(value.kind)) return null;
  return { itemId: value.itemId, kind: value.kind, before: versionOf(value.before), after: versionOf(value.after) };
}

function entries<Value>(value: unknown, read: (entry: unknown) => Value | null): Record<string, Value> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
    const parsed = read(entry);
    return parsed == null ? [] : [[key, parsed]];
  }));
}

/** What a project's record keeps of Delegation; what cannot be read is left out. */
export function parseDelegationRecord(value: unknown): DelegationRecord {
  if (!isRecord(value)) return EMPTY_RECORD;
  const list = <Value>(entry: unknown, read: (item: unknown) => Value | null): Value[] => (Array.isArray(entry) ? entry.flatMap((item) => read(item) ?? []) : []);
  return {
    waits: list(value.waits, waitOf),
    assignments: list(value.assignments, assignmentOf),
    failures: entries(value.failures, (entry) => (isRecord(entry) && text(entry.agentId) && text(entry.why) && text(entry.at) ? { agentId: entry.agentId, why: entry.why, at: entry.at } : null)),
    moduleAgents: entries(value.moduleAgents, (entry) => (text(entry) ? entry : null)),
    writers: list(value.writers, (entry) => (isRecord(entry) && text(entry.itemId) && text(entry.revision) && text(entry.agentId) ? { itemId: entry.itemId, revision: entry.revision, agentId: entry.agentId } : null)),
    replyChanges: entries(value.replyChanges, (entry) => (Array.isArray(entry) ? entry.flatMap((change) => replyChangeOf(change) ?? []) : null)),
    startedIn: entries(value.startedIn, (entry) => (isRecord(entry) && text(entry.moduleId) && text(entry.threadId) ? { moduleId: entry.moduleId, threadId: entry.threadId } : null)),
  };
}
