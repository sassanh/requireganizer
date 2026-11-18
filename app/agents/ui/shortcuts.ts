import type { ShortcutSpec } from "actions/shortcutText";

/** Open the agents and the waiting requests. */
export const agentsShortcut: ShortcutSpec = { key: "a" };

/** Go to the next unit of what an agent pointed the spec owner to last. */
export const takeOfferShortcut: ShortcutSpec = { key: "o" };

/** Dismiss what an agent pointed the spec owner to last. */
export const dismissOfferShortcut: ShortcutSpec = { key: "o", shift: true };
