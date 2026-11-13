import { isRecord } from "lib/json";

import type { RevealRequest } from "./context";

/** The parts of the browser's Navigation API the page uses; TypeScript's DOM types do not declare them yet. */
interface BrowserNavigation extends EventTarget {
  readonly currentEntry: NavigationHistoryEntry | null;
  entries(): NavigationHistoryEntry[];
  traverseTo(key: string): unknown;
}

interface EntryChange extends Event {
  readonly navigationType: "push" | "replace" | "reload" | "traverse" | null;
  readonly from: NavigationHistoryEntry;
}

/** Where an entry of this tab's history was opened from: the entry, and the unit or thread message it focused. */
export interface Opener {
  entry: string;
  place: RevealRequest | null;
}

function browserNavigation(): BrowserNavigation | null {
  return typeof window === "undefined" ? null : ((window as Window & { navigation?: BrowserNavigation }).navigation ?? null);
}

// Kept per tab, by entry key, since an entry's key outlives a reload and
// history.replaceState, which drops an entry's own Navigation API state.
const STORAGE_KEY = "requireganizer:openedFrom";

function readOpeners(): Record<string, Opener> {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "null");
    return isRecord(value) ? (value as Record<string, Opener>) : {};
  } catch {
    // No storage, or nothing readable in it.
    return {};
  }
}

function writeOpeners(openers: Record<string, Opener>): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(openers));
  } catch {
    // Without it the page offers no way back but the browser's own.
  }
}

let pending: Opener | null = null;
let installed = false;
const listeners = new Set<() => void>();

/** The next push from the entry an item is opened in records it as the opener of the entry pushed. */
function onEntryChange(event: Event): void {
  const change = event as EntryChange;
  const navigation = browserNavigation();
  if (change.navigationType === "push") {
    if (pending != null && change.from.key === pending.entry && navigation?.currentEntry != null) {
      const live = new Set(navigation.entries().map(({ key }) => key));
      const kept = Object.entries(readOpeners()).filter(([key]) => live.has(key));
      writeOpeners({ ...Object.fromEntries(kept), [navigation.currentEntry.key]: pending });
    }
    pending = null;
  }
  for (const listener of listeners) listener();
}

/** Call before the push that opens an item: it records the current entry, and `place` in it, as the opener of the entry pushed. */
export function recordOpener(place: RevealRequest | null): void {
  const current = browserNavigation()?.currentEntry;
  if (current == null) return;
  pending = { entry: current.key, place };
}

/** The opener of the current entry, while that entry is still in this tab's history; null in a browser without the Navigation API. */
export function currentOpener(): Opener | null {
  const navigation = browserNavigation();
  const current = navigation?.currentEntry;
  if (navigation == null || current == null) return null;
  const opener = readOpeners()[current.key];
  return opener != null && navigation.entries().some(({ key }) => key === opener.entry) ? opener : null;
}

/** Go back to the entry the current one was opened from, skipping whatever lies between. */
export function returnToOpener(): void {
  const opener = currentOpener();
  if (opener != null) browserNavigation()?.traverseTo(opener.entry);
}

/** The current entry's key, as useSyncExternalStore reads it; null in a browser without the Navigation API. */
export function currentEntryKey(): string | null {
  return browserNavigation()?.currentEntry?.key ?? null;
}

/** Subscribe to changes of the current entry, as useSyncExternalStore takes it. */
export function subscribeToEntries(listener: () => void): () => void {
  const navigation = browserNavigation();
  if (navigation == null) return () => {};
  if (!installed) {
    navigation.addEventListener("currententrychange", onEntryChange);
    installed = true;
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}
