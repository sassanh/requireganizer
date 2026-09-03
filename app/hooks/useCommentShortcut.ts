import {
  isEditableTarget,
  isOverlayTarget,
  selectedNavigateFrame,
  useShortcut,
  type ShortcutBinding,
} from "./shortcuts";

/** Single source for the key: the button tooltip renders it from here. */
export const COMMENT_SHORTCUT_KEY = "c";

/**
 * Open the selected frame's change-request popover through its own
 * button, reusing its open/disabled behavior instead of duplicating it.
 */
function openCommentForSelected(): void {
  selectedNavigateFrame()
    ?.querySelector<HTMLElement>("[data-comment-button]")
    ?.click();
}

const COMMENT_SHORTCUT: ShortcutBinding = {
  id: "request-change",
  key: COMMENT_SHORTCUT_KEY,
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
