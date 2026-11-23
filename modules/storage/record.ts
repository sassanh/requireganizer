import { InvalidJsonError, isRecord } from "lib/json";

import { type Address, isAddress } from "./pieces";

/**
 * What modules keep beside a project, each under its own key, apart from
 * its history: storage holds each whole and never reads it.
 */
export interface BesideProject {
  /** The Agents module's agents of the project. */
  agents: unknown;
  /** The Delegation module's threads waiting for an agent and what goes with them. */
  delegation: unknown;
  /** The Modules module's arrangement of the project's modules. */
  modules: unknown;
}

export type BesideProjectKey = keyof BesideProject;

export const NOTHING_BESIDE: BesideProject = { agents: null, delegation: null, modules: null };

/**
 * What storage keeps beside a project, never in it: the state it last wrote
 * for certain, the state being written while a write is under way, the
 * project's history, the offers of what agents pointed the spec owner to,
 * and what modules keep beside it, which storage holds whole and never reads.
 */
export interface ProjectRecord extends BesideProject {
  lastWritten: Address | null;
  writing: Address | null;
  history: unknown;
  offers: unknown;
}

/** The record as stored; its history, offers and what modules keep beside it stay as they were stored, for those who keep them to read. */
export function parseProjectRecord(value: unknown): ProjectRecord {
  if (!isRecord(value)) throw new InvalidJsonError("The project's record must be an object.");
  const address = (key: "lastWritten" | "writing"): Address | null => {
    const entry = value[key];
    if (entry === null) return null;
    if (!isAddress(entry)) throw new InvalidJsonError(`The project's record ${key} must be an address or null.`);
    return entry;
  };
  return {
    lastWritten: address("lastWritten"),
    writing: address("writing"),
    history: value.history ?? null,
    offers: value.offers ?? null,
    agents: value.agents ?? null,
    delegation: value.delegation ?? null,
    modules: value.modules ?? null,
  };
}
