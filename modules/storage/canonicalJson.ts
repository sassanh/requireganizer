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
  const text: Text = [];
  const now: WriteEntry = (entry, indent, into) => write(entry, indent, into, now);
  write(value, "", text, now);
  return `${text.join("")}\n`;
}

/** How long a write in slices keeps the thread before letting other work run. */
const SLICE_MS = 8;

/**
 * The same text as `serializeCanonical`, written a slice at a time: between
 * slices other work runs, so writing a large project never holds up a
 * request for more than one slice.
 */
export async function serializeCanonicalInSlices(value: unknown): Promise<string> {
  const text: Text = [];
  // Each entry of a list is written later, into the part of the text kept for it.
  const later: (() => void)[] = [];
  const inSlices: WriteEntry = (entry, indent, into) => {
    const part: Text = [];
    into.push(part);
    later.push(() => write(entry, indent, part, inSlices));
  };
  write(value, "", text, inSlices);
  let sliceStart = performance.now();
  for (let next = 0; next < later.length; next += 1) {
    later[next]!();
    if (performance.now() - sliceStart < SLICE_MS) continue;
    await new Promise((resolve) => setTimeout(resolve, 0));
    sliceStart = performance.now();
  }
  return `${joined(text)}\n`;
}

/** Text written so far, with the parts kept for what is written later in place. */
type Text = (string | Text)[];

function joined(text: Text): string {
  return text.map((part) => (typeof part === "string" ? part : joined(part))).join("");
}

/** Write an entry of a list into `text`, at `indent`. */
type WriteEntry = (value: unknown, indent: string, text: Text) => void;

/** Write `value` into `text`, handing each entry of a list to `entry`, which writes it now or keeps its place to write it later. */
function write(value: unknown, indent: string, text: Text, entry: WriteEntry): void {
  if (value === null || typeof value !== "object") {
    text.push(JSON.stringify(value) ?? "null");
    return;
  }
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      text.push("[]");
      return;
    }
    text.push("[\n");
    for (let index = 0; index < value.length; index += 1) {
      text.push(index === 0 ? inner : `,\n${inner}`);
      entry(value[index] ?? null, inner, text);
    }
    text.push(`\n${indent}]`);
    return;
  }
  const keys = Object.keys(value)
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (keys.length === 0) {
    text.push("{}");
    return;
  }
  text.push("{\n");
  for (let index = 0; index < keys.length; index += 1) {
    text.push(`${index === 0 ? "" : ",\n"}${inner}${JSON.stringify(keys[index])}: `);
    write((value as Record<string, unknown>)[keys[index]!], inner, text, entry);
  }
  text.push(`\n${indent}}`);
}
