import { InvalidJsonError, isRecord } from "lib/json";

import type { Signer } from "./records";

/** Who wrote a thread message: the spec owner, a model, or a coding agent by the name it gave. */
export type ThreadAuthor = Signer | { kind: "agent"; name: string };

export interface ThreadMessage {
  author: ThreadAuthor;
  text: string;
  at: string;
  /** The message answered with changes to items, not only words. */
  withChanges?: true;
}

/**
 * A change request on one unit and the conversation that answers it. Only
 * the spec owner resolves it. It keeps its stage, and once its unit is gone
 * the unit's last name, so it stays readable from the stage.
 */
export interface Thread {
  id: string;
  unitId: string;
  stage: string;
  /** The unit's name when it was removed; null while the unit exists. */
  removedUnit: string | null;
  messages: ThreadMessage[];
  resolvedAt: string | null;
}

/** A reply to a thread, as its answerer gives it. */
export interface ThreadAnswer {
  threadId: string;
  text: string;
}

export function authorLabel(author: ThreadAuthor): string {
  switch (author.kind) {
    case "person":
      return "You";
    case "model":
      return author.model;
    case "agent":
      return author.name;
  }
}

/** An open thread waits for the spec owner while its last message is not theirs. */
export function waitsForSpecOwner(thread: Thread): boolean {
  return thread.resolvedAt == null && thread.messages.at(-1)?.author.kind !== "person";
}

/** An open thread waits for its answerer while its last message is the spec owner's. */
export function waitsForAnswerer(thread: Thread): boolean {
  return thread.resolvedAt == null && thread.messages.at(-1)?.author.kind === "person";
}

/** One turn of a thread: it changes with every message, so whatever concerned a turn ends with it. */
export function threadTurn(thread: Thread): string {
  return `${thread.id}:${thread.messages.length}`;
}

/** An answerer at work on one turn of a thread, by the connection that took it up. */
export interface ThreadInHand {
  turn: string;
  by: string;
}

/** The thread as one text, for an answerer that reads it as a request. */
export function threadText(thread: Thread): string {
  return thread.messages
    .map(({ author, text }) => `${author.kind === "person" ? "Spec owner" : authorLabel(author)}: ${text}`)
    .join("\n");
}

function author(value: unknown, label: string): ThreadAuthor {
  if (isRecord(value)) {
    if (value.kind === "person") return { kind: "person" };
    if (value.kind === "model" && typeof value.model === "string") return { kind: "model", model: value.model };
    if (value.kind === "agent" && typeof value.name === "string") return { kind: "agent", name: value.name };
  }
  throw new InvalidJsonError(`${label} author must be a person, a model, or an agent.`);
}

/** Threads as stored. */
export function parseThreads(value: unknown): Thread[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new InvalidJsonError("Threads must be an array.");
  return value.map((entry, index) => {
    const label = `Thread ${index + 1}`;
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.unitId !== "string" || typeof entry.stage !== "string") {
      throw new InvalidJsonError(`${label} must have an id, a unit id and a stage.`);
    }
    if (!Array.isArray(entry.messages) || entry.messages.length === 0) {
      throw new InvalidJsonError(`${label} must have at least one message.`);
    }
    if (entry.resolvedAt != null && typeof entry.resolvedAt !== "string") {
      throw new InvalidJsonError(`${label} resolution time must be a string.`);
    }
    if (entry.removedUnit != null && typeof entry.removedUnit !== "string") {
      throw new InvalidJsonError(`${label} removed unit must be a string.`);
    }
    return {
      id: entry.id,
      unitId: entry.unitId,
      stage: entry.stage,
      removedUnit: entry.removedUnit ?? null,
      resolvedAt: entry.resolvedAt ?? null,
      messages: entry.messages.map((message, messageIndex) => {
        const messageLabel = `${label} message ${messageIndex + 1}`;
        if (!isRecord(message) || typeof message.text !== "string" || typeof message.at !== "string") {
          throw new InvalidJsonError(`${messageLabel} must have a text and a time.`);
        }
        return {
          author: author(message.author, messageLabel),
          text: message.text,
          at: message.at,
          ...(message.withChanges === true ? { withChanges: true as const } : {}),
        };
      }),
    };
  });
}
