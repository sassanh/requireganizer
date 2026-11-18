import { InvalidJsonError, isRecord } from "lib/json";

import type { Signer } from "./records";

/** Who wrote a thread message: the spec owner, a model, or an agent by its name. */
export type ThreadAuthor = Signer | { kind: "agent"; name: string };

export interface ThreadMessage {
  author: ThreadAuthor;
  text: string;
  /** When it was written; null in an export made without thread times. */
  at: string | null;
  /** The message answered with changes to items, not only words. */
  withChanges?: true;
  /** What another module says of the message, by its own keys; kept with the message and never read here. */
  annotations?: Readonly<Record<string, unknown>>;
}

/**
 * A change request on one unit and the conversation that answers it. Only
 * the spec owner resolves it. It keeps its stage, and once its unit is gone
 * the unit's last name, so it stays readable from the stage.
 */
/** A unit that is gone, as its threads keep it: its name and what it said when it was removed. */
export interface RemovedUnit {
  name: string;
  text: string;
}

export interface Thread {
  id: string;
  unitId: string;
  stage: string;
  /** The unit as it was when it was removed; null while the unit exists. */
  removedUnit: RemovedUnit | null;
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
    const removedUnit = entry.removedUnit ?? null;
    if (removedUnit != null && (!isRecord(removedUnit) || typeof removedUnit.name !== "string" || typeof removedUnit.text !== "string")) {
      throw new InvalidJsonError(`${label} removed unit must have a name and a text.`);
    }
    return {
      id: entry.id,
      unitId: entry.unitId,
      stage: entry.stage,
      removedUnit: removedUnit == null ? null : { name: removedUnit.name as string, text: removedUnit.text as string },
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
          ...(isRecord(message.annotations) ? { annotations: message.annotations } : {}),
        };
      }),
    };
  });
}
