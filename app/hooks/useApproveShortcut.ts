import { approveAction, approveShortcut } from "actions/actions";

import {
  isEditableTarget,
  isOverlayTarget,
  selectedNavigateFrame,
  useShortcut,
  type ShortcutBinding,
} from "./shortcuts";

/**
 * Press the selected frame's own Approve button through its action, if it
 * has a live one. Going through the button reuses every existing guard
 * (already approved, busy store) instead of duplicating them.
 */
function approveSelected(): void {
  selectedNavigateFrame()
    ?.querySelector<HTMLElement>(`[data-action="${approveAction.id}"]`)
    ?.click();
}

const APPROVE_SHORTCUT: ShortcutBinding = {
  id: approveAction.id,
  ...approveShortcut,
  when: (event) =>
    !isEditableTarget(event.target) && !isOverlayTarget(event.target),
  action: approveSelected,
};

/**
 * mod+A approves the selected item (the bordered one). Inside an editable
 * field the native select-all keeps working — the shortcut stays out.
 */
export function useApproveShortcut(): void {
  useShortcut(APPROVE_SHORTCUT);
}
