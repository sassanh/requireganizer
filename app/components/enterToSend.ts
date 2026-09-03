import type { KeyboardEvent } from "react";

import { SEND_SHORTCUT_SPEC } from "actions/shortcutText";

/**
 * Shared Enter-to-send behavior for multi-line message fields: Enter sends,
 * Shift+Enter makes a new line. Composing (IME) never sends. The send key
 * itself lives in the shared send shortcut, so the fields and the send
 * button hints can never disagree about it.
 */
export function isSendOnEnter(event: KeyboardEvent): boolean {
  return (
    event.key === SEND_SHORTCUT_SPEC.key &&
    !event.shiftKey &&
    !event.nativeEvent.isComposing
  );
}

/** If the keypress is a send, stop the newline and run send instead. */
export function sendOnEnter(event: KeyboardEvent, send: () => void): void {
  if (!isSendOnEnter(event)) return;
  event.preventDefault();
  send();
}
