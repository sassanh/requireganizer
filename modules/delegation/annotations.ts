import type { AgentId } from "agents/record";
import { isRecord } from "lib/json";
import type { Thread, ThreadMessage } from "workflow";

/** The key Delegation's annotations of a thread message are kept under. */
const OWN = "delegation";

/**
 * What an agent's reply finds wrong with an item: the item, of any module,
 * its revision when the finding was given, a published rule of its kind
 * that it breaks, and how.
 */
export interface Finding {
  itemId: string;
  revision: string;
  rule: string;
  how: string;
}

/** What a thread asks of the agent it is assigned to: an answer to the spec owner's message, or the update or a review of the thread's stage. */
export type AskKind = "message" | "update" | "review";

/** What Delegation says of an agent's reply: the agent that wrote it and its findings. */
export interface ReplyNotes {
  agentId: AgentId;
  findings: Finding[];
}

function own(message: Pick<ThreadMessage, "annotations">): Record<string, unknown> | null {
  const value = message.annotations?.[OWN];
  return isRecord(value) ? value : null;
}

/** The annotation of the spec owner's message that asks for a stage to be updated or reviewed. */
export function asksAnnotation(kind: "update" | "review"): Readonly<Record<string, unknown>> {
  return { [OWN]: { asks: kind } };
}

/** What a thread asks: what its first message asked, for a thread opened by asking for its stage to be updated or reviewed, else an answer to the spec owner's message. */
export function threadAsks(thread: Thread): AskKind {
  const asks = own(thread.messages[0]!)?.asks;
  return asks === "update" || asks === "review" ? asks : "message";
}

/** The annotation of an agent's reply. */
export function replyAnnotation(notes: ReplyNotes): Readonly<Record<string, unknown>> {
  return { [OWN]: { agentId: notes.agentId, ...(notes.findings.length === 0 ? {} : { findings: notes.findings }) } };
}

/** The agent that wrote a reply, as its annotation says; null for a message Delegation did not annotate. */
export function replyAgent(message: Pick<ThreadMessage, "annotations">): AgentId | null {
  const agentId = own(message)?.agentId;
  return typeof agentId === "string" ? agentId : null;
}

/** The findings a reply gives. */
export function findingsOf(message: Pick<ThreadMessage, "annotations">): Finding[] {
  const value = own(message)?.findings;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): Finding[] =>
    isRecord(entry) && typeof entry.itemId === "string" && typeof entry.revision === "string" && typeof entry.rule === "string" && typeof entry.how === "string"
      ? [{ itemId: entry.itemId, revision: entry.revision, rule: entry.rule, how: entry.how }]
      : [],
  );
}
