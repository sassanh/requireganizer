import { pulseElement } from "components/attention";
import { HIGHLIGHT_MILLISECONDS } from "components/changeQueue";
import { copyTextForElement } from "components/copy";
import { notify } from "components/notices";

import {
  isEditableTarget,
  isOverlayTarget,
  selectedNavigateFrame,
  useShortcut,
  type ShortcutBinding,
} from "./shortcuts";

/**
 * Copy the selected frame's content through its own registered provider.
 * A visible text selection of its own always wins: native copy handles it.
 */
function copySelected(): void {
  const frame = selectedNavigateFrame();
  if (frame == null || frame.id === "") return;
  const text = copyTextForElement(frame.id);
  if (text == null || text === "") return;
  writeClipboard(frame, text, "Copied to clipboard");
}

/**
 * Copy the selected item's address. Fragment cards link by their code
 * (FEA-1, like the links in the app); anything without a fragment
 * address copies the bare page.
 */
function copySelectedUrl(): void {
  const frame = selectedNavigateFrame();
  if (frame == null) return;
  const code = frame.getAttribute("data-fragment-code");
  // Keep the query string: the visible stage lives in ?step=..., and
  // dropping it lands the link on the wrong tab.
  const base = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  writeClipboard(frame, code != null && code !== "" ? `${base}#${code}` : base, "Copied link");
}

function writeClipboard(
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

function copyKeysLive(event: KeyboardEvent): boolean {
  if (isEditableTarget(event.target) || isOverlayTarget(event.target)) {
    return false;
  }
  const selection = window.getSelection();
  return selection == null || selection.isCollapsed;
}

const COPY_SHORTCUT: ShortcutBinding = {
  id: "copy-selected",
  key: "c",
  mod: true,
  when: copyKeysLive,
  action: copySelected,
};

const COPY_URL_SHORTCUT: ShortcutBinding = {
  id: "copy-selected-url",
  key: "c",
  mod: true,
  shift: true,
  when: copyKeysLive,
  action: copySelectedUrl,
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
