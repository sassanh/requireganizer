import { useEffect } from "react";

export interface ShortcutBinding {
  id: string;
  /** Matched against event.key, case-insensitively. */
  key: string;
  /** The primary modifier: Cmd on macOS, Ctrl elsewhere. No per-site platform branches. */
  mod?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Extra context check (typing focus, dialogs...). True means fire. */
  when?: (event: KeyboardEvent) => boolean;
  action: () => void;
}

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const userAgentData = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  const platform =
    userAgentData?.platform ?? navigator.platform ?? "";
  return /mac/i.test(platform);
}

/** Focus sits in a field the user can type in: leave its keys alone. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    return !target.readOnly && !target.disabled;
  }
  return false;
}

/** Focus sits in a transient overlay: leave its keys alone. */
export function isOverlayTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest(
      '[role="dialog"], [role="menu"], [role="listbox"]',
    ) != null
  );
}

/** The keyboard-selected frame (the bordered one), if focus is inside one. */
export function selectedNavigateFrame(): HTMLElement | null {
  const active =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  if (active == null) return null;
  return active.closest("[data-navigate-card]");
}

function matches(binding: ShortcutBinding, event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return false;
  if (event.key.toLowerCase() !== binding.key.toLowerCase()) return false;
  const mac = isMacPlatform();
  const wantCtrl = binding.ctrl ?? (binding.mod === true && !mac);
  const wantMeta = binding.meta ?? (binding.mod === true && mac);
  return (
    event.ctrlKey === wantCtrl &&
    event.metaKey === wantMeta &&
    event.shiftKey === (binding.shift ?? false) &&
    event.altKey === (binding.alt ?? false)
  );
}

const bindings = new Set<ShortcutBinding>();
let installed = false;

function handleKeyDown(event: KeyboardEvent): void {
  for (const binding of bindings) {
    if (!matches(binding, event)) continue;
    if (binding.when != null && !binding.when(event)) continue;
    event.preventDefault();
    binding.action();
    return;
  }
}

function registerShortcut(binding: ShortcutBinding): () => void {
  if (!installed) {
    window.addEventListener("keydown", handleKeyDown);
    installed = true;
  }
  bindings.add(binding);
  return () => {
    bindings.delete(binding);
    if (bindings.size === 0 && installed) {
      window.removeEventListener("keydown", handleKeyDown);
      installed = false;
    }
  };
}

/**
 * Declare a keyboard shortcut against the single shared listener.
 * Hoist the binding to module level so its identity is stable; actions
 * must read live state (store, DOM), never close over render scope.
 */
export function useShortcut(binding: ShortcutBinding): void {
  useEffect(() => registerShortcut(binding), [binding]);
}
