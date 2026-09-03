import {
  copyAction,
  copyShortcut,
  copyUrlAction,
  copyUrlShortcut,
} from "actions/actions";

import {
  isEditableTarget,
  isOverlayTarget,
  selectedNavigateFrame,
  useShortcut,
  type ShortcutBinding,
} from "./shortcuts";

function copyKeysLive(event: KeyboardEvent): boolean {
  if (isEditableTarget(event.target) || isOverlayTarget(event.target)) {
    return false;
  }
  const selection = window.getSelection();
  return selection == null || selection.isCollapsed;
}

const COPY_SHORTCUT: ShortcutBinding = {
  id: copyAction.id,
  ...copyShortcut,
  when: copyKeysLive,
  action: () => {
    const frame = selectedNavigateFrame();
    if (frame != null) copyAction.run(frame);
  },
};

const COPY_URL_SHORTCUT: ShortcutBinding = {
  id: copyUrlAction.id,
  ...copyUrlShortcut,
  when: copyKeysLive,
  action: () => {
    const frame = selectedNavigateFrame();
    if (frame != null) copyUrlAction.run(frame);
  },
};

/**
 * mod+C copies the selected item (the bordered one) as nicely formatted
 * plain text; mod+shift+C copies its address. Inside an editable field,
 * or with text selected, the native copy keeps working — the shortcuts
 * stay out.
 */
export function useCopyShortcut(): void {
  useShortcut(COPY_SHORTCUT);
  useShortcut(COPY_URL_SHORTCUT);
}
