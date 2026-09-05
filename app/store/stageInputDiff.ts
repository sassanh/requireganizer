import { canonicalJson } from "contract-domain";

/**
 * The plain sentences describing what changed between the inputs a stage
 * was generated from and its current inputs. One shared differ feeds the
 * refresh instruction, so the model always reads the same change list.
 */

const MAX_CHANGE_LINES = 25;
const MAX_QUOTE_LENGTH = 200;

type InputItem = Record<string, unknown> & { id: string };

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function quote(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  const flat = singleLine(text);
  return flat.length > MAX_QUOTE_LENGTH
    ? `"${flat.slice(0, MAX_QUOTE_LENGTH)}…"`
    : `"${flat}"`;
}

function isItemList(value: unknown): value is InputItem[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item != null &&
        typeof item === "object" &&
        typeof (item as { id?: unknown }).id === "string",
    )
  );
}

function itemText(item: InputItem): string {
  for (const key of ["content", "title", "name", "purpose"] as const) {
    const text = item[key];
    if (typeof text === "string" && text.trim() !== "") return text;
  }
  return JSON.stringify(item) ?? "";
}

/** Added, removed, and rewritten items between two lists sharing one id space. */
function diffItemLists(
  label: string,
  previous: InputItem[],
  current: InputItem[],
): string[] {
  const lines: string[] = [];
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const currentById = new Map(current.map((item) => [item.id, item]));
  for (const item of previous) {
    if (!currentById.has(item.id)) {
      lines.push(`${label} removed: ${quote(itemText(item))}.`);
    }
  }
  for (const item of current) {
    const before = previousById.get(item.id);
    if (before == null) {
      lines.push(`${label} added: ${quote(itemText(item))}.`);
    } else if (!sameValue(before, item)) {
      const beforeText = itemText(before);
      const afterText = itemText(item);
      if (beforeText !== afterText) {
        lines.push(
          `${label} changed from ${quote(beforeText)} to ${quote(afterText)}.`,
        );
      } else {
        const touched = Object.keys(item).filter(
          (key) => key !== "id" && !sameValue(before[key], item[key]),
        );
        lines.push(
          `${label} revised (${touched.join(", ") || "details"} changed): ${quote(afterText)}.`,
        );
      }
    }
  }
  return lines;
}

function changedSetLine(
  label: string,
  previous: unknown,
  current: unknown,
): string | null {
  if (previous == null && current == null) return null;
  if (typeof previous === "string" && typeof current === "string") {
    if (previous === current) return null;
    return `${label} changed from ${quote(previous)} to ${quote(current)}.`;
  }
  if (previous == null) return `${label} set to ${quote(current)}.`;
  if (current == null) return `${label} cleared (was ${quote(previous)}).`;
  if (!sameValue(previous, current)) {
    return `${label} changed from ${quote(previous)} to ${quote(current)}.`;
  }
  return null;
}

function diffOverview(previous: unknown, current: unknown): string[] {
  if (previous == null || current == null || typeof previous !== "object" || typeof current !== "object") {
    return [];
  }
  const lines: string[] = [];
  const before = previous as Record<string, unknown>;
  const after = current as Record<string, unknown>;
  for (const [label, key] of [
    ["Product name", "name"],
    ["Product purpose", "purpose"],
  ] as const) {
    const line = changedSetLine(label, before[key], after[key]);
    if (line != null) lines.push(line);
  }
  if (isItemList(before.primaryFeatures) || isItemList(after.primaryFeatures)) {
    lines.push(
      ...diffItemLists(
        "Primary feature",
        (isItemList(before.primaryFeatures) ? before.primaryFeatures : []) as InputItem[],
        (isItemList(after.primaryFeatures) ? after.primaryFeatures : []) as InputItem[],
      ),
    );
  }
  if (isItemList(before.targetUsers) || isItemList(after.targetUsers)) {
    lines.push(
      ...diffItemLists(
        "Target user",
        (isItemList(before.targetUsers) ? before.targetUsers : []) as InputItem[],
        (isItemList(after.targetUsers) ? after.targetUsers : []) as InputItem[],
      ),
    );
  }
  return lines;
}

/** A frozen design object changed: name the fields, not the whole blob. */
function diffDesignObject(label: string, previous: unknown, current: unknown): string[] {
  if (sameValue(previous, current)) return [];
  if (
    previous == null || current == null ||
    typeof previous !== "object" || typeof current !== "object" ||
    Array.isArray(previous) || Array.isArray(current)
  ) {
    return [`${label} changed from ${quote(previous)} to ${quote(current)}.`];
  }
  const before = previous as Record<string, unknown>;
  const after = current as Record<string, unknown>;
  const touched = new Set([...Object.keys(before), ...Object.keys(after)].filter(
    (key) => !sameValue(before[key], after[key]),
  ));
  if (touched.size === 1) {
    const [key] = [...touched];
    return [`${label} changed (${key}) from ${quote(before[key])} to ${quote(after[key])}.`];
  }
  return [`${label} changed (fields: ${[...touched].join(", ") || "unknown"}).`];
}

const LIST_SECTIONS: ReadonlyArray<readonly [string, string]> = [
  ["userStories", "User story"],
  ["requirements", "Requirement"],
  ["acceptanceCriteria", "Acceptance criterion"],
  ["testScenarios", "Test scenario"],
];

const DESIGN_SECTIONS: ReadonlyArray<readonly [string, string]> = [
  ["boundaryDesign", "Boundary design"],
  ["implementationProfile", "Implementation profile"],
  ["contractSuite", "Contract suite"],
  ["projectSetup", "Project setup"],
];

/**
 * One sentence per upstream change between the recorded inputs and the
 * current ones, capped so a large rewrite cannot flood the instruction.
 */
export function summarizeStageInputChange(
  previous: Record<string, unknown>,
  current: Record<string, unknown>,
): string[] {
  const lines: string[] = [];
  if ("productOverview" in previous || "productOverview" in current) {
    lines.push(...diffOverview(previous.productOverview, current.productOverview));
  }
  for (const [key, label] of LIST_SECTIONS) {
    if (!(key in previous) && !(key in current)) continue;
    const before = previous[key];
    const after = current[key];
    if (before == null && after == null) continue;
    if (!isItemList(before) || !isItemList(after)) {
      if (!sameValue(before, after)) lines.push(`${label}s changed.`);
      continue;
    }
    lines.push(...diffItemLists(label, before, after));
  }
  for (const [key, label] of DESIGN_SECTIONS) {
    if (!(key in previous) && !(key in current)) continue;
    lines.push(...diffDesignObject(label, previous[key], current[key]));
  }
  if (lines.length <= MAX_CHANGE_LINES) return lines;
  const kept = lines.slice(0, MAX_CHANGE_LINES);
  kept.push(`…and ${lines.length - MAX_CHANGE_LINES} more changes.`);
  return kept;
}
