import { requestChangeAction, requestChangeShortcut } from "actions/actions";

import {
  isEditableTarget,
  isOverlayTarget,
  selectedNavigateFrame,
  useShortcut,
  type ShortcutBinding,
} from "./shortcuts";

/**
 * Open the selected frame's change-request popover through its own button,
 * reusing its open/disabled behavior instead of duplicating it.
 */
function openCommentForSelected(): void {
  selectedNavigateFrame()
    ?.querySelector<HTMLElement>(`[data-action="${requestChangeAction.id}"]`)
    ?.click();
}

const COMMENT_SHORTCUT: ShortcutBinding = {
  id: requestChangeAction.id,
  ...requestChangeShortcut,
  when: (event) =>
    !isEditableTarget(event.target) && !isOverlayTarget(event.target),
  action: openCommentForSelected,
};

/**
 * C opens a change request on the selected item (the bordered one).
 * Inside an editable field the key keeps typing — the shortcut stays out.
 */
export function useCommentShortcut(): void {
  useShortcut(COMMENT_SHORTCUT);
}
