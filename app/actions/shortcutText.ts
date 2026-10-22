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
 * Short readable shortcut: ⌘Z on macOS, Ctrl+Z elsewhere, Enter, C.
 * Platform-dependent on purpose: only render this where the server markup
 * can omit it (closed menus, hover-only tooltips). Putting it in server
 * HTML would hydrate from Ctrl+Z to ⌘Z on macOS.
 */
export function shortcutText(spec: ShortcutSpec): string {
  const { mac, ctrl, meta, alt, shift } = resolveModifiers(spec);
  if (mac) {
    // Apple's own menu order — Control, Option, Shift, Command — and no
    // plus signs between the glyphs.
    const glyphs: string[] = [];
    if (ctrl) glyphs.push("⌃");
    if (alt) glyphs.push("⌥");
    if (shift) glyphs.push("⇧");
    if (meta) glyphs.push("⌘");
    glyphs.push(displayKey(spec.key));
    return glyphs.join("");
  }
  const parts: string[] = [];
  if (ctrl) parts.push("Ctrl");
  if (meta) parts.push("Cmd");
  if (alt) parts.push("Alt");
  if (shift) parts.push("Shift");
  parts.push(displayKey(spec.key));
  return parts.join("+");
}

/**
 * Spelled-out shortcut for assistive technology, following the same order
 * as the visible glyphs: "Command Shift M", "Control Z", "Enter".
 */
export function shortcutWords(spec: ShortcutSpec): string {
  const { mac, ctrl, meta, alt, shift } = resolveModifiers(spec);
  const parts: string[] = [];
  if (ctrl) parts.push("Control");
  if (mac) {
    if (alt) parts.push("Option");
    if (shift) parts.push("Shift");
    if (meta) parts.push("Command");
  } else {
    if (meta) parts.push("Command");
    if (alt) parts.push("Alt");
    if (shift) parts.push("Shift");
  }
  parts.push(displayKey(spec.key));
  return parts.join(" ");
}

function resolveModifiers(spec: ShortcutSpec) {
  const mac = isMacPlatform();
  return {
    mac,
    ctrl: spec.ctrl ?? (spec.mod === true && !mac),
    meta: spec.meta ?? (spec.mod === true && mac),
    alt: spec.alt === true,
    shift: spec.shift === true,
  };
}
