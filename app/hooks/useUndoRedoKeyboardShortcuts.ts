import {
  redoAction,
  redoShortcut,
  undoAction,
  undoShortcut,
} from "actions/actions";
import { redo, undo } from "store/timeline/controller";

import {
  isEditableTarget,
  useShortcut,
  type ShortcutBinding,
} from "./shortcuts";

/**
 * Global undo/redo keyboard shortcuts: mod+z undoes, mod+shift+z redoes
 * ("mod" is Cmd on macOS, Ctrl elsewhere). Genuinely editable fields keep
 * their own native undo; everywhere else — including the read-only
 * display fields this app is mostly made of, where native undo is a
 * no-op — the app timeline answers.
 * Safari claims cmd+z for "Undo Close Tab" and swallows it before the
 * page sees it; ctrl+z is the reliable undo there.
 */
const UNDO_SHORTCUT: ShortcutBinding = {
  id: undoAction.id,
  ...undoShortcut,
  when: (event) => !isEditableTarget(event.target),
  action: undo,
};

const REDO_SHORTCUT: ShortcutBinding = {
  id: redoAction.id,
  ...redoShortcut,
  when: (event) => !isEditableTarget(event.target),
  action: redo,
};

export function useUndoRedoKeyboardShortcuts(): void {
  useShortcut(UNDO_SHORTCUT);
  useShortcut(REDO_SHORTCUT);
}
