import {
  selectNextAction,
  selectNextShortcut,
  selectPreviousAction,
  selectPreviousShortcut,
} from "actions/actions";

import {
  isEditableTarget,
  isOverlayTarget,
  useShortcut,
  type ShortcutBinding,
} from "./shortcuts";

function selectionKeysLive(event: KeyboardEvent): boolean {
  return (
    !isEditableTarget(event.target) && !isOverlayTarget(event.target)
  );
}

const MOVE_NEXT_SHORTCUT: ShortcutBinding = {
  id: selectNextAction.id,
  ...selectNextShortcut,
  when: selectionKeysLive,
  action: () => selectNextAction.run(),
};

const MOVE_PREVIOUS_SHORTCUT: ShortcutBinding = {
  id: selectPreviousAction.id,
  ...selectPreviousShortcut,
  when: selectionKeysLive,
  action: () => selectPreviousAction.run(),
};

/**
 * j/k moves the selected card (the bordered one) across every fragment
 * list on screen, in reading order. Called once per list; the window
 * listener itself is shared by the shortcut registry.
 */
export function useFragmentNavigation(): void {
  useShortcut(MOVE_NEXT_SHORTCUT);
  useShortcut(MOVE_PREVIOUS_SHORTCUT);
}
