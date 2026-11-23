/** A unit's address: an item by its id, a coverage or an impact by its stage and the item it is on. */
export type UnitAddress =
  | { kind: "item"; itemId: string }
  | { kind: "coverage"; stage: string; itemId: string }
  | { kind: "impact"; stage: string; itemId: string };

export function coverageUnitId(stage: string, itemId: string): string {
  return `coverage:${stage}:${itemId}`;
}

export function impactUnitId(stage: string, itemId: string): string {
  return `impact:${stage}:${itemId}`;
}

/**
 * Where a thread shows in its stage: on its unit, or, for a thread on the
 * stage itself, in a place of its own among the stage's threads, which
 * names no unit.
 */
export function threadPlace(thread: { id: string; unitId: string | null }): string {
  return thread.unitId ?? `stage-thread:${thread.id}`;
}

export function parseUnitId(unitId: string): UnitAddress {
  const [kind, stage, itemId, ...rest] = unitId.split(":");
  if ((kind === "coverage" || kind === "impact") && stage != null && itemId != null && rest.length === 0) {
    return { kind, stage, itemId };
  }
  return { kind: "item", itemId: unitId };
}

/**
 * Where signing a unit moves the focus: from `from`, among the units its
 * stage showed before the signature, in `shownBefore`, to the next one,
 * wrapping around, that is not approved, or with `toSignable` that is
 * signable. The page sends it with the signature, so the step records the
 * move with the change.
 */
export interface SignatureFocusMove {
  from: string;
  shownBefore: string[];
  toSignable: boolean;
}

/**
 * The unit now in the place of one that is gone: of the units its stage
 * showed around it, in `shownBefore`, the next that still exists, else the
 * nearest before it that does; null for the stage itself, when none does or
 * the unit was not shown there.
 */
export function unitInPlaceOf(unitId: string, shownBefore: readonly string[], exists: (unitId: string) => boolean): string | null {
  const index = shownBefore.indexOf(unitId);
  if (index === -1) return null;
  return (
    shownBefore.slice(index + 1).find(exists) ??
    shownBefore.slice(0, index).reverse().find(exists) ??
    null
  );
}

/** Why a unit is not approved, each reason the spec owner is shown. */
export type NotApprovedReason = "no-signature" | "open-thread" | "out-of-date" | "proposed-removal";

export const NOT_APPROVED_REASON_LABELS: Record<NotApprovedReason, string> = {
  "no-signature": "No counting signature",
  "open-thread": "Open thread",
  "out-of-date": "Out of date",
  "proposed-removal": "Proposed for removal",
};

/** Why an item an out-of-date item references or depends on makes it out of date. */
export type LinkReason = "changed" | "removed" | "not-approved" | "out-of-date";

/** How an item that no longer exists is named, wherever it was named. */
export const REMOVED_ITEM = "removed item";

export const LINK_REASON_LABELS: Record<LinkReason, string> = {
  changed: "changed",
  removed: "removed",
  "not-approved": "not approved",
  "out-of-date": "out of date itself",
};

/** Where an item stands in its life: kept, proposed for removal, or removed while impacts on its removal wait. */
export type ItemPhase = "active" | "proposed-removal" | "removed";

/** What a signable item would be signed as, each item counted once. */
export type SignableCategory = "new" | "changed" | "out-of-date" | "proposed-removal";

export const SIGNABLE_CATEGORY_LABELS: Record<SignableCategory, string> = {
  new: "new",
  changed: "changed",
  "out-of-date": "out of date",
  "proposed-removal": "proposed for removal",
};

/** A stage's progress: whether it holds items, and whether everything in it is approved. */
export type StageProgress = "empty" | "in-progress" | "complete";

export const STAGE_PROGRESS_LABELS: Record<StageProgress, string> = {
  empty: "Empty",
  "in-progress": "In progress",
  complete: "Complete",
};
