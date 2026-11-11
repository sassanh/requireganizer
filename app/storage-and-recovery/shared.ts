import { isRecord } from "lib/json";

function idOf(entry: unknown): string | null {
  return isRecord(entry) && typeof entry.id === "string" ? entry.id : null;
}

/**
 * `next`, with every part that equals the part of `held` in its place taken
 * from `held`, and `held` itself when nothing differs. An entry of a list
 * that has an id is compared with the entry of that id, any other with the
 * entry at its position. Whatever holds `held` and compares parts by
 * identity, such as a store, then sees a change only where one was made.
 */
export function sharedWith<Value>(held: unknown, next: Value): Value {
  if (held === next) return next;
  if (Array.isArray(next)) {
    if (!Array.isArray(held)) return next;
    const byId = new Map(held.flatMap((entry) => (idOf(entry) == null ? [] : [[idOf(entry)!, entry] as const])));
    const entries = next.map((entry: unknown, index) => sharedWith(idOf(entry) == null ? held[index] : byId.get(idOf(entry)!), entry));
    const same = entries.length === held.length && entries.every((entry, index) => entry === held[index]);
    return (same ? held : entries) as Value;
  }
  if (isRecord(next)) {
    if (!isRecord(held)) return next;
    const entries = Object.entries(next).map(([key, value]) => [key, sharedWith(held[key], value)] as const);
    const same =
      entries.length === Object.keys(held).length &&
      entries.every(([key, value]) => Object.hasOwn(held, key) && value === held[key]);
    return (same ? held : Object.fromEntries(entries)) as Value;
  }
  return next;
}
