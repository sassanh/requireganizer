"use client";

import { List, ListItemButton, Paper, Popper, TextField, type TextFieldProps, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { type KeyboardEvent, type SyntheticEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { mentionMarkup } from "../threads";
import { useWorkflowView } from "./context";
import { ItemOption } from "./ItemChip";

/** The text typed to find an item to mention: where it starts, with its "#" when it has one, and what is typed after the "#". */
interface MentionSearch {
  start: number;
  typed: string;
  hash: boolean;
}

interface Mentionable {
  id: string;
  name: string;
}

/** How many items the list shows at once; typing more of a code narrows it. */
const SHOWN = 50;

/** Whether a "#" or a code may start after this character: at the start, or after anything that does not join it to a word, a code or a mention. */
function startsAfter(character: string | undefined): boolean {
  return character == null || !/[\p{L}\p{N}_\-/[\]#]/u.test(character);
}

/** The items the text typed to find one names: those whose name holds it, after a "#" in any case. */
function matchesOf(search: MentionSearch, items: readonly Mentionable[]): Mentionable[] {
  if (!search.hash) return items.filter(({ name }) => name.includes(search.typed));
  const typed = search.typed.toLowerCase();
  return items.filter(({ name }) => name.toLowerCase().includes(typed));
}

/**
 * The search the text before the caret makes: from the last "#" on its line
 * while some item's name holds what follows it, or else an item's full name
 * typed without a "#", the longest the text ends with.
 */
function searchAt(text: string, caret: number, items: readonly Mentionable[]): { search: MentionSearch; matches: Mentionable[] } | null {
  const before = text.slice(0, caret);
  const hash = before.lastIndexOf("#");
  if (hash >= 0 && startsAfter(before[hash - 1]) && !before.slice(hash).includes("\n")) {
    const search = { start: hash, typed: before.slice(hash + 1), hash: true };
    const matches = matchesOf(search, items);
    if (matches.length > 0) return { search, matches };
  }
  let full: string | null = null;
  for (const { name } of items) {
    if (before.endsWith(name) && startsAfter(before[caret - name.length - 1]) && (full == null || name.length > full.length)) full = name;
  }
  if (full == null) return null;
  const search = { start: caret - full.length, typed: full, hash: false };
  return { search, matches: matchesOf(search, items) };
}

/**
 * A thread message being written. Typing "#" opens the list of items for
 * marked mentions, of any module, and what follows the "#" narrows it to the
 * items whose name holds it; typing an item's full name without a "#" opens
 * it too. The item whose name is typed in full is highlighted. ↑ and ↓ move
 * the highlight, Enter or Tab accepts it and Esc closes the list; clicking an
 * item accepts it. Accepting replaces the typed text, and its "#", with a
 * marked mention of the item.
 */
const MentionField = observer(function MentionField({
  value,
  onChange,
  onKeyDown,
  ...props
}: Omit<TextFieldProps, "value" | "onChange" | "onKeyDown" | "slotProps" | "inputRef"> & {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const { module } = useWorkflowView();
  const listId = useId();
  const field = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  /** Where the caret is while the field has the focus; null while it does not. */
  const [caret, setCaret] = useState<number | null>(null);
  /** Where the search the person closed starts: the list stays closed for it. */
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<{ search: string; index: number } | null>(null);
  const caretAfterAccept = useRef<number | null>(null);

  const found = caret == null ? null : searchAt(value, caret, module.mentionableItems);
  const open = found != null && closedAt !== found.search.start;
  const shown = found == null ? [] : found.matches.slice(0, SHOWN);
  const searchKey = found == null ? "" : `${found.search.start}:${found.search.typed}`;
  const exact = found == null ? -1 : shown.findIndex(({ name }) => (found.search.hash ? name.toLowerCase() === found.search.typed.toLowerCase() : name === found.search.typed));
  const highlighted = highlight?.search === searchKey ? highlight.index : Math.max(exact, 0);

  useLayoutEffect(() => {
    const position = caretAfterAccept.current;
    if (position == null || input.current == null) return;
    caretAfterAccept.current = null;
    input.current.setSelectionRange(position, position);
    setCaret(position);
  }, [value]);

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${highlighted}`)?.scrollIntoView({ block: "nearest" });
  }, [open, highlighted, listId]);

  const followCaret = (event: SyntheticEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    setCaret(event.currentTarget.selectionStart);
    if (closedAt != null && (event.currentTarget.selectionStart ?? 0) < closedAt) setClosedAt(null);
  };

  const accept = (item: Mentionable) => {
    if (found == null || caret == null) return;
    const markup = mentionMarkup(item.name, item.id);
    caretAfterAccept.current = found.search.start + markup.length;
    onChange(value.slice(0, found.search.start) + markup + value.slice(caret));
  };

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (open && shown.length > 0) {
      const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setHighlight({ search: searchKey, index: (highlighted + step + shown.length) % shown.length });
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && plain) {
        event.preventDefault();
        accept(shown[highlighted]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setClosedAt(found.search.start);
        return;
      }
    }
    onKeyDown?.(event);
  };

  return (
    <>
      <TextField
        {...props}
        ref={field}
        inputRef={input}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          followCaret(event);
        }}
        onKeyDown={keyDown}
        slotProps={{
          htmlInput: {
            onSelect: followCaret,
            onFocus: followCaret,
            onBlur: () => setCaret(null),
            role: "combobox",
            "aria-autocomplete": "list",
            "aria-expanded": open,
            "aria-controls": open ? listId : undefined,
            "aria-activedescendant": open ? `${listId}-${highlighted}` : undefined,
          },
        }}
      />
      <Popper open={open} anchorEl={field.current} placement="top-start" sx={{ zIndex: (theme) => theme.zIndex.modal + 1 }}>
        <Paper elevation={8} sx={{ width: 440, maxWidth: "calc(100vw - 32px)", maxHeight: 320, overflowY: "auto" }}>
          <List dense role="listbox" id={listId} aria-label="Items to mention">
            {shown.map((item, index) => (
              <ListItemButton
                key={item.id}
                id={`${listId}-${index}`}
                role="option"
                tabIndex={-1}
                selected={index === highlighted}
                aria-selected={index === highlighted}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => accept(item)}
              >
                <ItemOption itemId={item.id} />
              </ListItemButton>
            ))}
          </List>
          {found != null && found.matches.length > SHOWN && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 2, pb: 1 }}>
              {found.matches.length - SHOWN} more: type more of the code to find them.
            </Typography>
          )}
        </Paper>
      </Popper>
    </>
  );
});

export default MentionField;
