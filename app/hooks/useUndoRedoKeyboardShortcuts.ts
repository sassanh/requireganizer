import { useEffect } from "react";

import { redo, undo } from "store/timeline/controller";

/**
 * Global undo/redo keyboard shortcuts: cmd/ctrl+z undoes, cmd/ctrl+shift+z
 * redoes. Text fields keep their own native undo — the shortcut is skipped
 * while typing. Safari claims cmd+z for "Undo Close Tab" and swallows it
 * before the page sees it; ctrl+z is the reliable undo there.
 */
export function useUndoRedoKeyboardShortcuts(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
