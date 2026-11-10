import { InvalidJsonError, isRecord } from "lib/json";

import type { Address } from "./pieces";

/** What a change to the project was, as its step names it. */
export type ChangeKind =
  | "edit"
  | "signature"
  | "thread message"
  | "thread resolution"
  | "coding agent write"
  | "restore"
  | "import"
  | "opening a changed project"
  | "module change";

const CHANGE_KINDS: readonly ChangeKind[] = [
  "edit",
  "signature",
  "thread message",
  "thread resolution",
  "coding agent write",
  "restore",
  "import",
  "opening a changed project",
  "module change",
];

/** One change to the project: the states before and after it. */
export interface HistoryStep {
  id: string;
  /** Counts up across the project's history, so the newest step has the highest. */
  sequence: number;
  before: Address;
  after: Address;
  at: string;
  kind: ChangeKind;
}

/**
 * What a project keeps beside itself: its steps, the state storage last
 * held for certain, and the state being written while a write is under way.
 */
export interface ProjectHistory {
  steps: HistoryStep[];
  lastWritten: Address | null;
  writing: Address | null;
}

/** The newest steps kept; older ones give way. */
export const KEPT_STEPS = 200;

export const EMPTY_HISTORY: ProjectHistory = { steps: [], lastWritten: null, writing: null };

/** Every state the history keeps. */
export function historyRoots(history: ProjectHistory): Address[] {
  return [
    ...history.steps.flatMap(({ before, after }) => [before, after]),
    ...(history.lastWritten == null ? [] : [history.lastWritten]),
    ...(history.writing == null ? [] : [history.writing]),
  ];
}

function isAddress(value: unknown): value is Address {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function parseStep(value: unknown, index: number): HistoryStep {
  const label = `Step ${index + 1}`;
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.sequence !== "number" ||
    !isAddress(value.before) ||
    !isAddress(value.after) ||
    typeof value.at !== "string" ||
    !CHANGE_KINDS.includes(value.kind as ChangeKind)
  ) {
    throw new InvalidJsonError(`${label} of the history is not one Requireganizer records.`);
  }
  return {
    id: value.id,
    sequence: value.sequence,
    before: value.before,
    after: value.after,
    at: value.at,
    kind: value.kind as ChangeKind,
  };
}

/** The history as stored. */
export function parseHistory(value: unknown): ProjectHistory {
  if (!isRecord(value) || !Array.isArray(value.steps)) throw new InvalidJsonError("The history must list its steps.");
  const address = (key: "lastWritten" | "writing"): Address | null => {
    const entry = value[key];
    if (entry === null) return null;
    if (!isAddress(entry)) throw new InvalidJsonError(`The history's ${key} must be an address or null.`);
    return entry;
  };
  return { steps: value.steps.map(parseStep), lastWritten: address("lastWritten"), writing: address("writing") };
}
