import { InvalidJsonError, isRecord } from "lib/json";

import { type Address, isAddress } from "./pieces";

/**
 * What storage keeps beside a project, never in it: the state it last wrote
 * for certain, the state being written while a write is under way, and the
 * project's history, the offers of what agents pointed the spec owner to,
 * and the spec owner's requests to agents with their run logs, which
 * storage holds whole and never reads.
 */
export interface ProjectRecord {
  lastWritten: Address | null;
  writing: Address | null;
  history: unknown;
  offers: unknown;
  requests: unknown;
}

/** The record as stored; its history, offers and requests stay as they were stored, for those who keep them to read. */
export function parseProjectRecord(value: unknown): ProjectRecord {
  if (!isRecord(value)) throw new InvalidJsonError("The project's record must be an object.");
  const address = (key: "lastWritten" | "writing"): Address | null => {
    const entry = value[key];
    if (entry === null) return null;
    if (!isAddress(entry)) throw new InvalidJsonError(`The project's record ${key} must be an address or null.`);
    return entry;
  };
  return { lastWritten: address("lastWritten"), writing: address("writing"), history: value.history ?? null, offers: value.offers ?? null, requests: value.requests ?? null };
}
