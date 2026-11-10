import { currentState, type ProjectHistory } from "./history";
import type { Address } from "./pieces";

/** The stored project as read: missing, unreadable with the reason, or a state with its address. */
export type StoredProject =
  | { kind: "missing" }
  | { kind: "unreadable"; problem: string }
  | { kind: "readable"; address: Address };

/**
 * How the stored project differs from the one Requireganizer last wrote,
 * because something else changed or removed it, such as a checkout of the
 * project file. `problem` says why the changed project cannot be opened;
 * null when it can.
 */
export type OutsideChange = { kind: "changed"; problem: string | null } | { kind: "removed" };

/**
 * The one rule for whether the stored project changed outside
 * Requireganizer. It is unchanged while its state is the one last written or
 * the one being written, however its bytes are laid out. One that cannot be
 * read is a change, with the reason; a missing one is a removal once
 * Requireganizer wrote it. Without a history there is nothing it could have
 * changed from.
 */
export function storedProjectChange(stored: StoredProject, history: ProjectHistory | null): OutsideChange | null {
  if (history == null) return null;
  switch (stored.kind) {
    case "missing":
      return history.lastWritten == null ? null : { kind: "removed" };
    case "unreadable":
      return { kind: "changed", problem: stored.problem };
    case "readable":
      return stored.address === history.lastWritten || stored.address === history.writing
        ? null
        : { kind: "changed", problem: null };
  }
}

/**
 * What opening a project shows and writes, from the stored project S, the
 * state last written W and the state the history is at C.
 * - `open stored`: S is W or the one being written, and is C.
 * - `write current`: S is W or the one being written but not C, so
 *   Requireganizer's own change was not written, as after a crash. C shows
 *   and is written.
 * - `outside change`: S changed or was removed outside Requireganizer. C
 *   shows, and nothing is written until the spec owner chooses.
 * - `start`: there is no history, so S becomes W, with no steps.
 * - `cannot open`: there is no history to show instead of a stored project
 *   that cannot be opened.
 */
export type Opening<Readable> =
  | { kind: "open stored"; stored: Readable }
  | { kind: "write current"; current: Address }
  | { kind: "outside change"; change: OutsideChange; current: Address }
  | { kind: "start"; stored: Readable }
  | { kind: "cannot open"; problem: string | null };

type ReadableOf<Stored extends StoredProject> = Extract<Stored, { kind: "readable" }>;

function isReadable<Stored extends StoredProject>(stored: Stored): stored is ReadableOf<Stored> {
  return stored.kind === "readable";
}

export function openingOf<Stored extends StoredProject>(
  stored: Stored,
  history: ProjectHistory | null,
): Opening<ReadableOf<Stored>> {
  const current = history == null ? null : currentState(history);
  if (history == null || current == null) {
    if (isReadable(stored)) return { kind: "start", stored };
    return { kind: "cannot open", problem: stored.kind === "unreadable" ? stored.problem : null };
  }
  const change = storedProjectChange(stored, history);
  if (change != null) return { kind: "outside change", change, current };
  return isReadable(stored) && stored.address === current
    ? { kind: "open stored", stored }
    : { kind: "write current", current };
}
