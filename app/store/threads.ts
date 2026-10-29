import { InvalidJsonError, isRecord } from "lib/json";

import type { Reviewer } from "./review";

/**
 * Who answers the person's change requests: Requireganizer's own writer,
 * or the coding agent connected over MCP.
 */
export type ThreadAnswerer = "requireganizer" | "coding-agent";

export const THREAD_ANSWERERS: readonly ThreadAnswerer[] = ["requireganizer", "coding-agent"];

/** Who wrote a thread message: the person, a model of Requireganizer's, or a connected agent by the name it gave. */
export type ThreadAuthor = Reviewer | { kind: "agent"; name: string };

export interface ThreadMessage {
  author: ThreadAuthor;
  text: string;
  at: string;
  /** The message answered with a submission of the work, not only words. */
  withSubmission?: true;
}

/**
 * A change request on one reviewable unit and the conversation that answers
 * it. Whose turn it is follows from the last message; only the person
 * resolves it. A thread whose unit no longer exists is over.
 */
export interface ReviewThread {
  id: string;
  unitId: string;
  messages: ThreadMessage[];
  resolvedAt: string | null;
}

/** A reply to a thread, as an answerer gives it. */
export interface ThreadAnswer {
  threadId: string;
  text: string;
}

export function answererLabel(answerer: ThreadAnswerer): string {
  return answerer === "requireganizer" ? "Requireganizer's AI" : "the coding agent";
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

/** An open thread waits for the person once anyone else spoke last. */
export function waitsForPerson(thread: ReviewThread): boolean {
  return thread.resolvedAt == null && thread.messages.at(-1)?.author.kind !== "person";
}

/** Who an open thread waits for: the person once anyone else spoke last, otherwise the project's answerer. */
export function waitingFor(thread: ReviewThread, answerer: ThreadAnswerer): "person" | ThreadAnswerer {
  return waitsForPerson(thread) ? "person" : answerer;
}

/** The thread as one text, for an answerer that reads it as a request. */
export function threadText(thread: ReviewThread): string {
  if (thread.messages.length === 1) return thread.messages[0]!.text;
  return thread.messages
    .map(({ author, text }) => `${author.kind === "person" ? "Person" : authorLabel(author)}: ${text}`)
    .join("\n");
}

/** The threads with one more message on an open thread; throws when the thread is not open. */
export function withMessage(
  threads: readonly ReviewThread[],
  threadId: string,
  message: ThreadMessage,
): ReviewThread[] {
  const thread = threads.find(({ id }) => id === threadId);
  if (thread == null) throw new Error(`No thread ${threadId}.`);
  if (thread.resolvedAt != null) throw new Error(`Thread ${threadId} is resolved.`);
  return threads.map((candidate) =>
    candidate === thread ? { ...thread, messages: [...thread.messages, message] } : candidate,
  );
}

function author(value: unknown, label: string): ThreadAuthor {
  if (isRecord(value)) {
    if (value.kind === "person") return { kind: "person" };
    if (value.kind === "model" && typeof value.model === "string") return { kind: "model", model: value.model };
    if (value.kind === "agent" && typeof value.name === "string") return { kind: "agent", name: value.name };
  }
  throw new InvalidJsonError(`${label} author must be a person, a model, or an agent.`);
}

/** Threads as stored or imported; a module from before threads has none. */
export function parseThreads(value: unknown): ReviewThread[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new InvalidJsonError("Threads must be an array.");
  return value.map((entry, index) => {
    const label = `Thread ${index + 1}`;
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.unitId !== "string") {
      throw new InvalidJsonError(`${label} must have an id and a unit id.`);
    }
    if (!Array.isArray(entry.messages) || entry.messages.length === 0) {
      throw new InvalidJsonError(`${label} must have at least one message.`);
    }
    if (!isRecord(entry.messages[0]) || !isRecord(entry.messages[0].author) || entry.messages[0].author.kind !== "person") {
      throw new InvalidJsonError(`${label} must be opened by the person.`);
    }
    if (entry.resolvedAt != null && typeof entry.resolvedAt !== "string") {
      throw new InvalidJsonError(`${label} resolution time must be a string.`);
    }
    return {
      id: entry.id,
      unitId: entry.unitId,
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
          ...(message.withSubmission === true ? { withSubmission: true as const } : {}),
        };
      }),
    };
  });
}
