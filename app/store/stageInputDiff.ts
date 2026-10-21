import type { JsonValue } from "contract-domain";

/**
 * The plain sentences describing how a stage's inputs changed since the
 * stage acknowledged them. One shared describer feeds the refresh
 * instruction, so the model always reads the same change list.
 */

const MAX_CHANGE_LINES = 25;
const MAX_QUOTE_LENGTH = 200;

export interface InputChange {
  id: string;
  code: string | null;
  before: JsonValue;
  after: JsonValue;
}

function quote(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_QUOTE_LENGTH
    ? `"${flat.slice(0, MAX_QUOTE_LENGTH)}…"`
    : `"${flat}"`;
}

/** The readable text of an input, or null for a formal artifact known only by revision. */
function inputText(value: JsonValue): string | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  for (const key of ["content", "title", "name", "purpose"]) {
    const text = value[key];
    if (typeof text === "string" && text.trim() !== "") return text;
  }
  return null;
}

function describe(change: InputChange): string {
  const label = change.code ?? change.id;
  if (change.before == null) {
    const text = inputText(change.after);
    return text == null ? `Added ${label}.` : `Added ${label}: ${quote(text)}.`;
  }
  if (change.after == null) return `Removed ${label}.`;
  const before = inputText(change.before);
  const after = inputText(change.after);
  if (before == null || after == null) return `Revised ${label}.`;
  if (before === after) return `Changed the links of ${label}.`;
  return `Rewrote ${label}: ${quote(before)} → ${quote(after)}.`;
}

export function summarizeInputChanges(changes: readonly InputChange[]): string[] {
  const lines = changes.map(describe);
  if (lines.length <= MAX_CHANGE_LINES) return lines;
  return [
    ...lines.slice(0, MAX_CHANGE_LINES),
    `…and ${lines.length - MAX_CHANGE_LINES} more changes.`,
  ];
}
