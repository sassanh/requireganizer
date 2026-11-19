import type { ReactNode } from "react";

import type { ShortcutSpec } from "./shortcutText";

/**
 * A reusable action: what it does, what it works on, when it can run.
 * Buttons only point at an action plus its live target; the name, picture,
 * shortcut, hint, availability, and run all come from here.
 */
export interface Action<Target> {
  id: string;
  name: string;
  icon: ReactNode;
  shortcut?: ShortcutSpec;
  isEnabled(target: Target): boolean;
  run(target: Target): void;
}

/**
 * Opens the module switcher — or the one-time dialog that enables
 * modules. Cmd+M is reserved by macOS (minimize), hence the Shift.
 */
export const switchModuleShortcut: ShortcutSpec = { key: "m", mod: true, shift: true };

/** Undo the project's current step. */
export const undoShortcut: ShortcutSpec = { key: "z", mod: true };

/** Redo the step undo last took back. */
export const redoShortcut: ShortcutSpec = { key: "z", mod: true, shift: true };

/** Redo as Windows and Linux programs also take it. */
export const redoAlternateShortcut: ShortcutSpec = { key: "y", ctrl: true };

/** Open the list of steps. */
export const stepsShortcut: ShortcutSpec = { key: "h" };

/** Open the list of restore points. */
export const restorePointsShortcut: ShortcutSpec = { key: "r" };

/** Sign the focused unit; with Shift, focus then moves to the next one waiting for a signature. */
export const signShortcut: ShortcutSpec = { key: "s" };

/** Open the focused unit's threads, to request a change or reply. */
export const threadShortcut: ShortcutSpec = { key: "c" };

/** Request a change on the stage shown, in a thread of its own. */
export const stageThreadShortcut: ShortcutSpec = { key: "c", shift: true };

/** Resolve the open thread; the send key with Shift, so it works while the message is being written. */
export const resolveShortcut: ShortcutSpec = { key: "Enter", mod: true, shift: true };

/** Go back to where the item shown was opened from. */
export const returnShortcut: ShortcutSpec = { key: "b" };

/** In a preview, move to the next difference it marks, across stages and modules. */
export const nextMarkShortcut: ShortcutSpec = { key: "n" };

/** In a preview, move to the previous difference it marks. */
export const previousMarkShortcut: ShortcutSpec = { key: "n", shift: true };

/** Close a preview, showing the project now. */
export const closePreviewShortcut: ShortcutSpec = { key: "Escape", shift: true };

