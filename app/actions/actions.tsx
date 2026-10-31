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
