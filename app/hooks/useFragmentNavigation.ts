import {
  MARGIN_PIXELS,
  scrollIntoViewWithMargin,
} from "components/scrollFollower";

import {
  isEditableTarget,
  isOverlayTarget,
  useShortcut,
  type ShortcutBinding,
} from "./shortcuts";

function fragmentCards(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-navigate-card]"),
  ).filter((card) => card.getClientRects().length > 0);
}

function moveSelection(direction: 1 | -1): void {
  const cards = fragmentCards();
  if (cards.length === 0) return;
  const active =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const currentIndex =
    active == null
      ? -1
      : cards.findIndex(
          (card) => card === active || card.contains(active),
        );
  const nextIndex =
    currentIndex === -1
      ? (direction === 1 ? 0 : cards.length - 1)
      : Math.min(cards.length - 1, Math.max(0, currentIndex + direction));
  const next = cards[nextIndex];
  if (next == null || next === active) return;
  // Selection only: the focus border moves, the address bar is untouched.
  // Prefer the text box inside (fields show their own focus ring); fall
  // back to the frame itself (cards outline the whole frame).
  const focusTarget =
    next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement
      ? next
      : (next.querySelector<HTMLElement>("input, textarea") ?? next);
  focusTarget.focus({ preventScroll: true });
  scrollIntoViewWithMargin(next, "nearest", MARGIN_PIXELS);
}

function selectionKeysLive(event: KeyboardEvent): boolean {
  return (
    !isEditableTarget(event.target) && !isOverlayTarget(event.target)
  );
}

const MOVE_NEXT_SHORTCUT: ShortcutBinding = {
  id: "selection-next",
  key: "j",
  when: selectionKeysLive,
  action: () => moveSelection(1),
};

const MOVE_PREVIOUS_SHORTCUT: ShortcutBinding = {
  id: "selection-previous",
  key: "k",
  when: selectionKeysLive,
  action: () => moveSelection(-1),
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
