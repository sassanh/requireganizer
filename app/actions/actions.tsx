import {
  ArrowDownward,
  ArrowRight,
  ArrowUpward,
  Check,
  Comment,
  ContentCopy,
  Link as LinkIcon,
  Redo,
  Send,
  Undo,
} from "@mui/icons-material";
import type { ReactNode } from "react";

import { pulseElement } from "components/attention";
import { HIGHLIGHT_MILLISECONDS } from "components/changeQueue";
import { copyTextForElement } from "components/copy";
import { notify } from "components/notices";
import { scrollIntoViewWithMargin, MARGIN_PIXELS } from "components/scrollFollower";
import { redo, undo } from "store/timeline/controller";

import { SEND_SHORTCUT_SPEC, type ShortcutSpec } from "./shortcutText";

/**
 * A reusable action: what it does, what it works on, when it can run.
 * Buttons only point at an action plus its live target; the name, picture,
 * shortcut, hint, availability, and run all come from here.
 */
export interface Action<Target> {
  id: string;
  name: string;
  icon: ReactNode;
  shortcut?: ShortcutSpec;
  isEnabled(target: Target): boolean;
  run(target: Target): void;
}

/** Global availability: blocked by busy work, offered when there is history. */
export interface HistoryTarget {
  blocked: boolean;
  available: boolean;
}

/** Text availability: blocked by busy work, offered when there is text. */
export interface SendTarget {
  blocked: boolean;
  text: string;
  send: () => void;
}

export const undoShortcut: ShortcutSpec = { key: "z", mod: true };
export const redoShortcut: ShortcutSpec = { key: "z", mod: true, shift: true };

export const undoAction: Action<HistoryTarget> = {
  id: "timeline-undo",
  name: "Undo",
  icon: <Undo fontSize="small" />,
  shortcut: undoShortcut,
  isEnabled: ({ blocked, available }) => !blocked && available,
  run: () => undo(),
};

export const redoAction: Action<HistoryTarget> = {
  id: "timeline-redo",
  name: "Redo",
  icon: <Redo fontSize="small" />,
  shortcut: redoShortcut,
  isEnabled: ({ blocked, available }) => !blocked && available,
  run: () => redo(),
};

function isSendable({ blocked, text }: SendTarget): boolean {
  return !blocked && text.trim().length > 0;
}

function sendTarget({ send }: SendTarget): void {
  send();
}

export const sendMessageAction: Action<SendTarget> = {
  id: "send-message",
  name: "Send message",
  icon: <Send />,
  shortcut: SEND_SHORTCUT_SPEC,
  isEnabled: isSendable,
  run: sendTarget,
};

export const sendChangeRequestAction: Action<SendTarget> = {
  id: "send-change-request",
  name: "Send change request",
  icon: <Send />,
  shortcut: SEND_SHORTCUT_SPEC,
  isEnabled: isSendable,
  run: sendTarget,
};

export const copyShortcut: ShortcutSpec = { key: "c", mod: true };
export const copyUrlShortcut: ShortcutSpec = {
  key: "c",
  mod: true,
  shift: true,
};

function frameCopyText(frame: HTMLElement): string | null {
  if (frame.id === "") return null;
  const text = copyTextForElement(frame.id);
  return text == null || text === "" ? null : text;
}

function writeCopyResult(
  frame: HTMLElement,
  text: string,
  successMessage: string,
): void {
  if (typeof navigator.clipboard?.writeText !== "function") {
    notify("Copy failed", "error");
    return;
  }
  void navigator.clipboard.writeText(text).then(
    () => {
      pulseElement(frame, HIGHLIGHT_MILLISECONDS);
      notify(successMessage);
    },
    () => {
      notify("Copy failed", "error");
    },
  );
}

export const copyAction: Action<HTMLElement> = {
  id: "copy-selected",
  name: "Copy",
  icon: <ContentCopy fontSize="small" />,
  shortcut: copyShortcut,
  isEnabled: (frame) => frameCopyText(frame) != null,
  run: (frame) => {
    const text = frameCopyText(frame);
    if (text == null) return;
    writeCopyResult(frame, text, "Copied to clipboard");
  },
};

export const copyUrlAction: Action<HTMLElement> = {
  id: "copy-selected-url",
  name: "Copy link",
  icon: <LinkIcon fontSize="small" />,
  shortcut: copyUrlShortcut,
  isEnabled: () => true,
  run: (frame) => {
    const code = frame.getAttribute("data-fragment-code");
    // Keep the query string: the visible stage lives in ?step=..., and
    // dropping it lands the link on the wrong tab.
    const base = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    writeCopyResult(
      frame,
      code != null && code !== "" ? `${base}#${code}` : base,
      "Copied link",
    );
  },
};

export const selectNextShortcut: ShortcutSpec = { key: "j" };
export const selectPreviousShortcut: ShortcutSpec = { key: "k" };

function fragmentCards(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-navigate-card]"),
  ).filter((card) => card.getClientRects().length > 0);
}

function focusNavigateCard(card: HTMLElement): void {
  // Selection only: the focus border moves, the address bar is untouched.
  // Prefer the text box inside (fields show their own focus ring); fall
  // back to the frame itself (cards outline the whole frame).
  const focusTarget =
    card instanceof HTMLInputElement || card instanceof HTMLTextAreaElement
      ? card
      : (card.querySelector<HTMLElement>("input, textarea") ?? card);
  focusTarget.focus({ preventScroll: true });
  scrollIntoViewWithMargin(card, "nearest", MARGIN_PIXELS);
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
  focusNavigateCard(next);
}

/** Post-approve advance: strictly the next item, nothing at the end. */
function advanceSelection(): void {
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
  const next = cards[currentIndex + 1];
  if (next == null) return;
  focusNavigateCard(next);
}

export const selectNextAction: Action<void> = {
  id: "selection-next",
  name: "Select next item",
  icon: <ArrowDownward fontSize="small" />,
  shortcut: selectNextShortcut,
  isEnabled: () => fragmentCards().length > 0,
  run: () => moveSelection(1),
};

export const selectPreviousAction: Action<void> = {
  id: "selection-previous",
  name: "Select previous item",
  icon: <ArrowUpward fontSize="small" />,
  shortcut: selectPreviousShortcut,
  isEnabled: () => fragmentCards().length > 0,
  run: () => moveSelection(-1),
};

export const approveShortcut: ShortcutSpec = { key: "a", mod: true };
export const requestChangeShortcut: ShortcutSpec = { key: "c" };

/** An approvable item: its guards plus the approval itself, read live. */
export interface ApproveTarget {
  blocked: boolean;
  approvable: boolean;
  approve: () => void;
}

export const approveAction: Action<ApproveTarget> = {
  id: "approve-selected",
  name: "Approve",
  icon: <Check fontSize="small" />,
  shortcut: approveShortcut,
  isEnabled: ({ blocked, approvable }) => !blocked && approvable,
  run: ({ approve }) => {
    approve();
    notify("Approved");
    // Review flow: approving moves on to the next item when there is one.
    advanceSelection();
  },
};

/** A change request: its guard plus opening the request box. */
export interface RequestChangeTarget {
  blocked: boolean;
  open: () => void;
}

export const requestChangeAction: Action<RequestChangeTarget> = {
  id: "request-change",
  name: "Request change",
  icon: <Comment fontSize="small" />,
  shortcut: requestChangeShortcut,
  isEnabled: ({ blocked }) => !blocked,
  run: ({ open }) => open(),
};

export const generateNextShortcut: ShortcutSpec = { key: "Enter", mod: true };

/** Guarded opener: blocked only while busy; otherwise the reason speaks. */
export interface PrepareGenerateTarget {
  blocked: boolean;
  reason: string | null;
  open: () => void;
}

export const prepareGenerateAction: Action<PrepareGenerateTarget> = {
  id: "prepare-generate",
  name: "Generate next stage",
  icon: <ArrowRight fontSize="small" />,
  shortcut: generateNextShortcut,
  isEnabled: ({ blocked }) => !blocked,
  run: ({ reason, open }) => {
    if (reason != null) {
      notify(reason, "error");
      return;
    }
    open();
  },
};
