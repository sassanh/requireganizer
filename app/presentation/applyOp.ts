import type { ChangeFocusOp } from "store/timeline/controller";

function itemIdOf(value: unknown): string | undefined {
  return typeof (value as { id?: unknown } | null)?.id === "string"
    ? (value as { id: string }).id
    : undefined;
}

function walk(
  tree: unknown,
  parts: string[],
): unknown {
  let node = tree;
  for (const part of parts) {
    if (node == null) return undefined;
    if (Array.isArray(node)) {
      node = node.find((entry) => itemIdOf(entry) === part);
      continue;
    }
    if (typeof node === "object") {
      node = (node as Record<string, unknown>)[part];
      continue;
    }
    return undefined;
  }
  return node;
}

function parentAndKey(
  tree: Record<string, unknown>,
  parts: string[],
): { parent: unknown; key: string } | null {
  if (parts.length === 0) return null;
  const key = parts[parts.length - 1]!;
  const parent = parts.length === 1 ? tree : walk(tree, parts.slice(0, -1));
  if (parent == null) return null;
  return { parent, key };
}

/** MST snapshots treat a missing key as defaultable; an explicit
 * `undefined` is a type error on `string` fields. */
function omitUndefined<Value>(value: Value): Value {
  if (Array.isArray(value)) {
    return value.map(omitUndefined) as Value;
  }
  if (value != null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (entry === undefined) continue;
      result[key] = omitUndefined(entry);
    }
    return result as Value;
  }
  return value;
}

function mergeItem(current: unknown, incoming: unknown): unknown {
  if (
    current != null &&
    typeof current === "object" &&
    !Array.isArray(current) &&
    incoming != null &&
    typeof incoming === "object" &&
    !Array.isArray(incoming)
  ) {
    return { ...current, ...incoming };
  }
  return incoming;
}

/** Apply one recorded op onto a plain store snapshot. */
export function applyOpToTree(
  tree: Record<string, unknown>,
  op: ChangeFocusOp,
): Record<string, unknown> {
  const next = structuredClone(tree);
  const parts = op.subject.split("/").filter((part) => part.length > 0);
  if (parts.length === 0) return omitUndefined(next);

  if (op.kind === "add") {
    const collection = walk(next, parts.slice(0, -1));
    if (Array.isArray(collection) && op.itemSnapshot != null) {
      const newId = itemIdOf(op.itemSnapshot) ?? op.itemId;
      const alreadyThere =
        newId != null &&
        collection.some((entry) => itemIdOf(entry) === newId);
      if (!alreadyThere) collection.push(op.itemSnapshot);
    }
    return omitUndefined(next);
  }

  if (op.kind === "remove") {
    const collection = walk(next, parts.slice(0, -1));
    if (Array.isArray(collection)) {
      const index = collection.findIndex(
        (entry) => itemIdOf(entry) === op.itemId,
      );
      if (index >= 0) collection.splice(index, 1);
    }
    return omitUndefined(next);
  }

  if (op.itemSnapshot != null && op.itemId != null) {
    const collection = walk(next, parts.slice(0, -1));
    if (Array.isArray(collection)) {
      const index = collection.findIndex(
        (entry) => itemIdOf(entry) === op.itemId,
      );
      if (index >= 0) {
        collection[index] = mergeItem(collection[index], op.itemSnapshot);
      }
    }
    return omitUndefined(next);
  }

  const target = parentAndKey(next, parts);
  if (target == null) return omitUndefined(next);
  const { parent, key } = target;
  if (parent != null && typeof parent === "object" && !Array.isArray(parent)) {
    const record = parent as Record<string, unknown>;
    if (op.value === undefined) delete record[key];
    else record[key] = op.value;
  }
  return omitUndefined(next);
}
