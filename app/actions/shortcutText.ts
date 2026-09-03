import { isMacPlatform, type ShortcutBinding } from "hooks/shortcuts";

/** The shortcut half of an action: what the button hint shows. */
export type ShortcutSpec = Pick<
  ShortcutBinding,
  "key" | "mod" | "ctrl" | "meta" | "shift" | "alt"
>;

/** Single home for the send key: the field behavior and the send hints. */
export const SEND_SHORTCUT_SPEC: ShortcutSpec = { key: "Enter" };

function displayKey(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/**
 * Short readable shortcut: Cmd+Z on macOS, Ctrl+Z elsewhere, Enter, C.
 * Client-only on purpose: the button fills it in after mounting so the
 * server render stays identical everywhere.
 */
export function shortcutText(spec: ShortcutSpec): string {
  const mac = isMacPlatform();
  const wantCtrl = spec.ctrl ?? (spec.mod === true && !mac);
  const wantMeta = spec.meta ?? (spec.mod === true && mac);
  const parts: string[] = [];
  if (wantCtrl) parts.push("Ctrl");
  if (wantMeta) parts.push("Cmd");
  if (spec.alt === true) parts.push("Alt");
  if (spec.shift === true) parts.push("Shift");
  parts.push(displayKey(spec.key));
  return parts.join("+");
}

/** Button hint: name plus shortcut when the action has one. */
export function actionHint(name: string, shortcut?: ShortcutSpec): string {
  if (shortcut == null) return name;
  return `${name} (${shortcutText(shortcut)})`;
}
