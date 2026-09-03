/**
 * Transient action confirmations ("Copied to clipboard", "Approved").
 * Fired from anywhere — including module-level shortcut actions with no
 * store access — and shown by the single Notices host at the app shell.
 */
export type NoticeSeverity = "success" | "error";

export interface Notice {
  id: number;
  message: string;
  severity: NoticeSeverity;
}

let nextId = 0;
const listeners = new Set<(notice: Notice) => void>();

export function notify(
  message: string,
  severity: NoticeSeverity = "success",
): void {
  const notice = { id: nextId++, message, severity };
  listeners.forEach((listener) => listener(notice));
}

export function subscribeNotices(
  listener: (notice: Notice) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
