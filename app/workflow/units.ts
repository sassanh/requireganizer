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

export function parseUnitId(unitId: string): UnitAddress {
  const [kind, stage, itemId, ...rest] = unitId.split(":");
  if ((kind === "coverage" || kind === "impact") && stage != null && itemId != null && rest.length === 0) {
    return { kind, stage, itemId };
  }
  return { kind: "item", itemId: unitId };
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

export const LINK_REASON_LABELS: Record<LinkReason, string> = {
  changed: "changed",
  removed: "removed",
  "not-approved": "not approved",
  "out-of-date": "out of date itself",
};

/** Where an item stands in its life: kept, proposed for removal, or removed while impacts on its removal wait. */
export type ItemPhase = "active" | "proposed-removal" | "removed";

/** What in a stage waits for a signature, each item counted once. */
export type WaitingCategory = "new" | "changed" | "out-of-date" | "proposed-removal";

export const WAITING_CATEGORY_LABELS: Record<WaitingCategory, string> = {
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
