/**
 * The one way Requireganizer writes a project as JSON: keys sorted by UTF-16
 * code unit, two spaces of indent and a closing newline. Equal values always
 * have equal bytes, whatever order their keys were inserted in, so the file,
 * every export and every piece change only where the project changed.
 *
 * It writes the text itself rather than sorting an object for
 * `JSON.stringify`, since objects list keys that look like integers first.
 */
export function serializeCanonical(value: unknown): string {
  return `${write(value, "")}\n`;
}

function write(value: unknown, indent: string): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const entries = value.map((entry: unknown) => `${inner}${write(entry ?? null, inner)}`);
    return `[\n${entries.join(",\n")}\n${indent}]`;
  }
  const keys = Object.keys(value)
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (keys.length === 0) return "{}";
  const entries = keys.map(
    (key) => `${inner}${JSON.stringify(key)}: ${write((value as Record<string, unknown>)[key], inner)}`,
  );
  return `{\n${entries.join(",\n")}\n${indent}}`;
}
