import type { ShortcutSpec } from "actions/shortcutText";

/** Open every thread. */
export const threadsShortcut: ShortcutSpec = { key: "t" };

/** Go to the next unit of what an agent pointed the spec owner to last. */
export const takeOfferShortcut: ShortcutSpec = { key: "o" };

/** Dismiss what an agent pointed the spec owner to last. */
export const dismissOfferShortcut: ShortcutSpec = { key: "o", shift: true };
