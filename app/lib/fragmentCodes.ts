/**
 * An item's code: its list's prefix and its number, padded to at least two
 * digits and to as many as the list's largest number has, so every code of
 * one list has the same width (REQ-01 … REQ-99, then REQ-001 … REQ-100).
 */
export function formatCode(prefix: string, number: number, listLength: number): string {
  const width = Math.max(2, String(listLength).length);
  return `${prefix}-${String(number).padStart(width, "0")}`;
}

/** Whether `written` names the item `code` names, however its number is padded. */
export function codesMatch(written: string, code: string): boolean {
  const [writtenPrefix, writtenNumber] = codeParts(written) ?? [];
  const [prefix, number] = codeParts(code) ?? [];
  return writtenPrefix != null && writtenPrefix === prefix && writtenNumber === number;
}

function codeParts(code: string): [string, number] | null {
  const match = /^([A-Z]+)-(\d+)$/.exec(code);
  return match == null ? null : [match[1]!, Number(match[2])];
}
