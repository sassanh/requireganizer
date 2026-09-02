export type ListChangeDropped = {
  id: string;
  code: string;
};

export type ListChange = {
  kept: string[];
  changed: string[];
  added: string[];
  dropped: ListChangeDropped[];
};

export type ListChangeCaption = {
  grain: "item" | "stage";
  itemId: string | null;
  text: string | null;
};

export type ListChangeBeforeItem = {
  id: string;
  code: string;
};

export type ListChangeAfterItem = {
  id: string;
  lastSignedContent: string | null;
  pendingRemoval?: boolean;
};

export function classifyListChange(
  before: readonly ListChangeBeforeItem[],
  after: readonly ListChangeAfterItem[],
): ListChange {
  const beforeById = new Map(before.map((item) => [item.id, item]));
  const kept: string[] = [];
  const changed: string[] = [];
  const added: string[] = [];
  const dropped: ListChangeDropped[] = [];

  for (const item of after) {
    const previous = beforeById.get(item.id);
    if (previous == null) {
      added.push(item.id);
      continue;
    }
    if (item.pendingRemoval === true) {
      dropped.push({ id: item.id, code: previous.code });
      continue;
    }
    if (item.lastSignedContent != null) {
      changed.push(item.id);
    } else {
      kept.push(item.id);
    }
  }
  return { kept, changed, added, dropped };
}

function formatStageLine(change: ListChange): string {
  const parts: string[] = [];
  if (change.kept.length > 0) parts.push(`Kept ${change.kept.length}`);
  if (change.changed.length > 0) parts.push(`Rewrote ${change.changed.length}`);
  if (change.added.length > 0) parts.push(`Added ${change.added.length}`);
  if (change.dropped.length > 0) {
    parts.push(`Dropped ${change.dropped.map((item) => item.code).join(", ")}`);
  }
  return parts.join(" · ");
}

/** Grain is decided here, not by the model. */
export function listChangeCaption(change: ListChange): ListChangeCaption {
  if (
    change.changed.length === 1 &&
    change.added.length === 0 &&
    change.dropped.length === 0
  ) {
    return { grain: "item", itemId: change.changed[0]!, text: null };
  }
  if (
    change.changed.length === 0 &&
    change.added.length === 0 &&
    change.dropped.length === 1
  ) {
    return { grain: "item", itemId: change.dropped[0]!.id, text: null };
  }
  if (change.changed.length === 0 && change.dropped.length === 0) {
    if (change.added.length > 0 && change.kept.length === 0) {
      return { grain: "stage", itemId: null, text: null };
    }
    if (change.added.length === 0) {
      return { grain: "stage", itemId: null, text: null };
    }
  }
  const text = formatStageLine(change);
  return { grain: "stage", itemId: null, text: text.length === 0 ? null : text };
}
