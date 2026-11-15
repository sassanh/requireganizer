import { InvalidJsonError, isRecord } from "lib/json";

import { type Address, isAddress } from "./pieces";

/**
 * What storage keeps beside a project, never in it: the state it last wrote
 * for certain, the state being written while a write is under way, and the
 * project's history and the offers of what the coding agent named for the
 * spec owner's attention, which storage holds whole and never reads.
 */
export interface ProjectRecord {
  lastWritten: Address | null;
  writing: Address | null;
  history: unknown;
  offers: unknown;
}

/** The record as stored; its history and offers stay as they were stored, for those who keep them to read. */
export function parseProjectRecord(value: unknown): ProjectRecord {
  if (!isRecord(value)) throw new InvalidJsonError("The project's record must be an object.");
  const address = (key: "lastWritten" | "writing"): Address | null => {
    const entry = value[key];
    if (entry === null) return null;
    if (!isAddress(entry)) throw new InvalidJsonError(`The project's record ${key} must be an address or null.`);
    return entry;
  };
  return { lastWritten: address("lastWritten"), writing: address("writing"), history: value.history ?? null, offers: value.offers ?? null };
}
