import { InvalidJsonError, isRecord } from "lib/json";

import type { Signer } from "./records";

/** Who wrote a thread message: the spec owner, a model, or a coding agent by the name it gave. */
export type ThreadAuthor = Signer | { kind: "agent"; name: string };

export interface ThreadMessage {
  author: ThreadAuthor;
  text: string;
  /** When it was written; null in an export made without thread times. */
  at: string | null;
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
  /** Set once the spec owner resolved it; its time is null in an export made without thread times. */
  resolution: { at: string | null } | null;
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
  return thread.resolution == null && thread.messages.at(-1)?.author.kind !== "person";
}

/** An open thread waits for its answerer while its last message is the spec owner's. */
export function waitsForAnswerer(thread: Thread): boolean {
  return thread.resolution == null && thread.messages.at(-1)?.author.kind === "person";
}

/** One turn of a thread: it changes with every message, so whatever concerned a turn ends with it. */
export function threadTurn(thread: Thread): string {
  return `${thread.id}:${thread.messages.length}`;
}

/** An answerer at work on one turn, of a thread or of a request to write a stage, by the connection that took it up. */
export interface TurnInHand {
  turn: string;
  by: string;
}

/**
 * A marked mention in a thread message's text: the part of it that names one
 * item, tied to the item by its id. It is written as a Markdown link to
 * `item:<id>`, so the text stays plain and every reader of Markdown keeps it
 * apart from the text around it. A writer gives the item's code as the link's
 * text, to be checked against the id; a kept message holds the id alone.
 */
export interface Mention {
  start: number;
  end: number;
  writtenAs: string;
  itemId: string;
}

const MENTION_SCHEME = "item:";
const MENTION_PATTERN = /\[((?:\\.|[^\\\]\n])*)\]\(item:([^\s()]+)\)/g;

/** A marked mention of an item, written as `[name](item:<id>)`. */
export function mentionMarkup(name: string, itemId: string): string {
  return `[${name.replace(/[\\[\]]/g, "\\$&")}](${MENTION_SCHEME}${itemId})`;
}

/** Every marked mention a text holds, in order. */
export function mentionsIn(text: string): Mention[] {
  return [...text.matchAll(MENTION_PATTERN)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    writtenAs: match[1]!.replace(/\\(.)/g, "$1"),
    itemId: match[2]!,
  }));
}

/**
 * A marked mention, in a reply sent with item changes, of an item those
 * changes add: it has no id before the write, so it names the add change by
 * its place among the changes, counting from 1, written `[](change:<place>)`.
 */
export interface AddedMention {
  start: number;
  end: number;
  change: number;
}

const ADDED_MENTION_PATTERN = /\[(?:\\.|[^\\\]\n])*\]\(change:(\d+)\)/g;

/** Every marked mention of an added item a reply holds, in order. */
export function addedMentionsIn(text: string): AddedMention[] {
  return [...text.matchAll(ADDED_MENTION_PATTERN)].map((match) => ({ start: match.index, end: match.index + match[0].length, change: Number(match[1]) }));
}

function replaceEach<Found extends { start: number; end: number }>(text: string, found: readonly Found[], replace: (each: Found) => string): string {
  let result = "";
  let last = 0;
  for (const each of found) {
    result += text.slice(last, each.start) + replace(each);
    last = each.end;
  }
  return result + text.slice(last);
}

/** The text with each marked mention replaced as `replace` gives it. */
export function replaceMentions(text: string, replace: (mention: Mention) => string): string {
  return replaceEach(text, mentionsIn(text), replace);
}

/** The text with each marked mention of an added item replaced as `replace` gives it. */
export function replaceAddedMentions(text: string, replace: (mention: AddedMention) => string): string {
  return replaceEach(text, addedMentionsIn(text), replace);
}

/**
 * A message's text as it is kept: trimmed, with each marked mention by its
 * item's id alone. The code a writer gave is never kept, since codes move;
 * the item's code is read from the id each time the message shows.
 */
export function keptMessageText(text: string): string {
  return replaceMentions(text.trim(), ({ itemId }) => mentionMarkup("", itemId));
}

/** The item a link's address marks as mentioned, or null for any other link. */
export function mentionedItem(href: string): string | null {
  return href.startsWith(MENTION_SCHEME) && href.length > MENTION_SCHEME.length ? href.slice(MENTION_SCHEME.length) : null;
}

/** How an answerer through the agent interface writes a marked mention, and what it is. */
export const MENTION_MARKUP_TEXT =
  "A marked mention ties a part of a reply to one item: write it [CODE](item:ID), with the item's code and id as get_items gives them, or [Module name/CODE](item:ID) for an item of another module than the thread's. The spec owner sees it by the item's code at the time they read it, with a preview and a way to open it; a code written outside a marked mention is plain text, tied to no item. A reply holding a marked mention whose code names no item, or another item than its id, is refused. In a reply sent with write_items, mark an item the write adds as [](change:N), N being the place of its add change among the changes, counting from 1; the spec owner sees it by the code the item gets. A reply is refused if N is not among its changes or that change adds no item.";

/** The rules every reply of an answerer through the agent interface follows. */
export const REPLY_RULES: readonly string[] = [
  "it speaks only to its thread's request;",
  "it makes sense read on its own;",
  "it gives an item's code only inside a marked mention of that item; and",
  "it names each item that no longer exists when the reply is sent by what the item said, never by a code.",
];

/** The reply rules and the mention markup as one text, for an answerer through the agent interface. */
export function replyRulesText(): string {
  return `Each reply follows these rules: ${REPLY_RULES.join(" ")} ${MENTION_MARKUP_TEXT}`;
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
    const resolution = entry.resolution ?? null;
    if (resolution != null && (!isRecord(resolution) || (resolution.at !== null && typeof resolution.at !== "string"))) {
      throw new InvalidJsonError(`${label} resolution must have a time or null.`);
    }
    if (entry.removedUnit != null && typeof entry.removedUnit !== "string") {
      throw new InvalidJsonError(`${label} removed unit must be a string.`);
    }
    return {
      id: entry.id,
      unitId: entry.unitId,
      stage: entry.stage,
      removedUnit: entry.removedUnit ?? null,
      resolution: resolution == null ? null : { at: resolution.at as string | null },
      messages: entry.messages.map((message, messageIndex) => {
        const messageLabel = `${label} message ${messageIndex + 1}`;
        if (!isRecord(message) || typeof message.text !== "string" || (message.at !== null && typeof message.at !== "string")) {
          throw new InvalidJsonError(`${messageLabel} must have a text, and a time or null.`);
        }
        return {
          author: author(message.author, messageLabel),
          text: message.text,
          at: message.at as string | null,
          ...(message.withChanges === true ? { withChanges: true as const } : {}),
        };
      }),
    };
  });
}
