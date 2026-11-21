import { isRecord } from "lib/json";
import type { Thread, ThreadMessage } from "workflow";

/** The key the Agents module's annotations of a thread message are kept under. */
const OWN = "agents";

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

/** What a thread asks of the agent it is assigned to: an answer to the spec owner's message, or the writing or a review of the thread's stage. */
export type AskKind = "message" | "write" | "review";

function own(message: Pick<ThreadMessage, "annotations">): Record<string, unknown> | null {
  const value = message.annotations?.[OWN];
  return isRecord(value) ? value : null;
}

/** The annotation of the spec owner's message that asks for a stage to be written or reviewed. */
export function asksAnnotation(kind: "write" | "review"): Readonly<Record<string, unknown>> {
  return { [OWN]: { asks: kind } };
}

/**
 * What a thread asks: what its first message asked, for a thread opened by
 * asking for its stage to be written or reviewed, else an answer to the
 * spec owner's message.
 */
export function threadAsks(thread: Thread): AskKind {
  const asks = own(thread.messages[0]!)?.asks;
  return asks === "write" || asks === "review" ? asks : "message";
}

/** The annotation of an agent's reply that gives findings; none when it gives none. */
export function findingsAnnotation(findings: readonly Finding[]): Readonly<Record<string, unknown>> | undefined {
  return findings.length === 0 ? undefined : { [OWN]: { findings } };
}

/** The findings a message gives. */
export function findingsOf(message: Pick<ThreadMessage, "annotations">): Finding[] {
  const value = own(message)?.findings;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): Finding[] =>
    isRecord(entry) && typeof entry.itemId === "string" && typeof entry.revision === "string" && typeof entry.rule === "string" && typeof entry.how === "string"
      ? [{ itemId: entry.itemId, revision: entry.revision, rule: entry.rule, how: entry.how }]
      : [],
  );
}
