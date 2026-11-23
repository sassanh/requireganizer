import { isRecord } from "lib/json";

/** An agent, by the id the Agents module gives it, which it keeps until it is archived and after. */
export type AgentId = string;

/** What a coding agent's connection tells of it. */
export interface ConnectionDetails {
  /** Its coding tool's name, such as "claude-code"; null when the tool gave none. */
  tool: string | null;
  toolVersion: string | null;
  /** The computer it connects from. */
  host: string | null;
  /** Its coding tool tells no session, so the agent is known by the id the system gives it. */
  sessionless: boolean;
  /** Its coding tool lets the project send a message into its session. */
  reachable: boolean;
}

/** What one part of an internal agent's context is about, as the module that ran it names it. */
export interface ContextTopic {
  /** The same for every part about the same thing, such as a thread. */
  key: string;
  label: string;
}

/**
 * One run of an internal agent: what it was asked, what it did and what
 * its AI provider returned, as the messages of its conversation. The
 * agent's context is all its parts' messages, in order.
 */
export interface ContextPart {
  topic: ContextTopic;
  from: string;
  /** Null while the run goes on. */
  until: string | null;
  messages: unknown[];
}

/** An agent as the project keeps it. A coding agent is kept once it has a name. */
export type StoredAgent =
  | {
      id: AgentId;
      kind: "internal";
      name: string | null;
      templateId: string;
      /** The template's name when the agent was started, shown should the template be removed once the agent is archived. */
      templateName: string;
      startedAt: string;
      archivedAt: string | null;
      context: ContextPart[];
    }
  | {
      id: AgentId;
      kind: "coding";
      name: string;
      /** The hash of the session its coding tool tells; null for a sessionless coding agent, known by its id. */
      session: string | null;
      namedAt: string;
      archivedAt: string | null;
      /** What its connection last told of it. */
      details: ConnectionDetails | null;
    };

const text = (value: unknown): value is string => typeof value === "string";
const textOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";

function detailsOf(value: unknown): ConnectionDetails | null {
  if (!isRecord(value) || !textOrNull(value.tool) || !textOrNull(value.toolVersion) || !textOrNull(value.host)) return null;
  if (typeof value.sessionless !== "boolean" || typeof value.reachable !== "boolean") return null;
  return { tool: value.tool, toolVersion: value.toolVersion, host: value.host, sessionless: value.sessionless, reachable: value.reachable };
}

function partOf(value: unknown): ContextPart | null {
  if (!isRecord(value) || !isRecord(value.topic) || !text(value.topic.key) || !text(value.topic.label)) return null;
  if (!text(value.from) || !textOrNull(value.until) || !Array.isArray(value.messages)) return null;
  return { topic: { key: value.topic.key, label: value.topic.label }, from: value.from, until: value.until, messages: value.messages };
}

function agentOf(value: unknown): StoredAgent | null {
  if (!isRecord(value) || !text(value.id) || !textOrNull(value.archivedAt)) return null;
  if (value.kind === "internal") {
    if (!textOrNull(value.name) || !text(value.templateId) || !text(value.templateName) || !text(value.startedAt) || !Array.isArray(value.context)) return null;
    return {
      id: value.id,
      kind: "internal",
      name: value.name,
      templateId: value.templateId,
      templateName: value.templateName,
      startedAt: value.startedAt,
      archivedAt: value.archivedAt,
      context: value.context.flatMap((part) => partOf(part) ?? []),
    };
  }
  if (value.kind === "coding") {
    if (!text(value.name) || !textOrNull(value.session) || !text(value.namedAt)) return null;
    return { id: value.id, kind: "coding", name: value.name, session: value.session, namedAt: value.namedAt, archivedAt: value.archivedAt, details: detailsOf(value.details) };
  }
  return null;
}

/** The agents a project's record keeps; an entry that cannot be read is left out. */
export function parseStoredAgents(value: unknown): StoredAgent[] {
  if (!isRecord(value) || !Array.isArray(value.agents)) return [];
  return value.agents.flatMap((entry) => agentOf(entry) ?? []);
}

/** The agents as a project's record keeps them. */
export const storedAgentsRecord = (agents: readonly StoredAgent[]): unknown => ({ agents });
