"use client";

import { List, ListItemButton, Paper, Popper, TextField, Typography } from "@mui/material";
import Document from "@tiptap/extension-document";
import Mention, { type MentionNodeAttrs } from "@tiptap/extension-mention";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions";
import { type Editor, EditorContent, type JSONContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps, useEditor } from "@tiptap/react";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import { observer } from "mobx-react-lite";
import {
  type FocusEventHandler,
  forwardRef,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { mentionMarkup } from "../threads";
import { useWorkflowView } from "./context";
import ItemChip, { ItemOption, useItemName } from "./ItemChip";

/** A message being written, as its editor holds it: paragraphs of plain text and marked mentions. */
export type MessageDraft = JSONContent;

const MENTION = "mention";

/** How a marked mention counts in the text before the caret: one character that joins no code. */
const MENTION_CHARACTER = "￼";

/**
 * The message a draft sends: its paragraphs as lines, plain text as typed,
 * each marked mention by the name `nameOf` gives its item.
 */
export function messageText(draft: MessageDraft | null, nameOf: (itemId: string) => string): string {
  return (draft?.content ?? [])
    .map(({ content = [] }) =>
      content.map((node) => (node.type === MENTION ? mentionMarkup(nameOf(String(node.attrs?.id)), String(node.attrs?.id)) : (node.text ?? ""))).join(""),
    )
    .join("\n");
}

interface Mentionable {
  id: string;
  name: string;
}

/** The text typed to find an item to mention: where it starts, with its "#" when it has one, and what is typed after the "#". */
interface MentionSearch {
  start: number;
  typed: string;
  hash: boolean;
}

/** How many items the list shows at once; typing more of a code narrows it. */
const SHOWN = 50;

/** Whether a "#" or a code may start after this character: at the start, or after anything that does not join it to a word, a code or a mention. */
function startsAfter(character: string | undefined): boolean {
  return character == null || !/[\p{L}\p{N}_\-/[\]#]/u.test(character);
}

/** The items the text typed to find one names: those whose name holds it, after a "#" in any case. */
function matchesOf(search: Omit<MentionSearch, "start">, items: readonly Mentionable[]): Mentionable[] {
  if (!search.hash) return items.filter(({ name }) => name.includes(search.typed));
  const typed = search.typed.toLowerCase();
  return items.filter(({ name }) => name.toLowerCase().includes(typed));
}

/**
 * The search a paragraph's text before the caret makes: from its last "#"
 * while some item's name holds what follows it, or else an item's full name
 * typed without a "#", the longest the text ends with.
 */
function searchAt(before: string, items: readonly Mentionable[]): MentionSearch | null {
  const hash = before.lastIndexOf("#");
  if (hash >= 0 && startsAfter(before[hash - 1])) {
    const search = { start: hash, typed: before.slice(hash + 1), hash: true };
    if (matchesOf(search, items).length > 0) return search;
  }
  let full: string | null = null;
  for (const { name } of items) {
    if (before.endsWith(name) && startsAfter(before[before.length - name.length - 1]) && (full == null || name.length > full.length)) full = name;
  }
  return full == null ? null : { start: before.length - full.length, typed: full, hash: false };
}

/** The list a suggestion opened: what is typed, where, and how to accept an item for it. */
interface OpenList {
  from: number;
  typed: string;
  hash: boolean;
  accept: (item: Mentionable) => void;
}

/** What the editor's suggestions ask of the field, as it renders now. */
interface ListControls {
  items: () => readonly Mentionable[];
  nameOf: (itemId: string) => string;
  keyDown: (event: globalThis.KeyboardEvent) => boolean;
}

/**
 * One suggestion of the mention node: the "#" search, or an item's full
 * name typed without a "#". Both read the one search the text before the
 * caret makes, so at most one is open.
 */
function suggestion(
  hash: boolean,
  controls: RefObject<ListControls | null>,
  showList: (list: OpenList | null) => void,
): Omit<SuggestionOptions<Mentionable, MentionNodeAttrs>, "editor"> {
  const show = (props: SuggestionProps<Mentionable, MentionNodeAttrs>) =>
    showList({ from: props.range.from, typed: props.query, hash, accept: ({ id }) => props.command({ id }) });
  return {
    char: "#",
    findSuggestionMatch: ({ $position }) => {
      const before = $position.parent.textBetween(0, $position.parentOffset, undefined, MENTION_CHARACTER);
      const search = searchAt(before, controls.current?.items() ?? []);
      if (search == null || search.hash !== hash) return null;
      return { range: { from: $position.start() + search.start, to: $position.pos }, query: search.typed, text: before.slice(search.start) };
    },
    command: ({ editor, range, props }) => {
      editor.chain().focus().insertContentAt(range, { type: MENTION, attrs: { id: props.id } }).run();
    },
    render: () => ({
      onStart: show,
      onUpdate: show,
      onExit: () => showList(null),
      onKeyDown: ({ event }) => controls.current?.keyDown(event) ?? false,
    }),
  };
}

/** A marked mention in the editor: the chip a posted message shows for its item. */
function MentionChip({ node }: ReactNodeViewProps) {
  return (
    <NodeViewWrapper as="span">
      <ItemChip itemId={String(node.attrs.id)} opens={false} />
    </NodeViewWrapper>
  );
}

/** The editor as a text field's input sees it: it takes the focus, and holds the message text. */
interface FieldInput {
  focus: () => void;
  value: string;
}

/** The editor in the place of a text field's input, so the field keeps its outline, label and focus. */
const EditorInput = forwardRef<
  FieldInput,
  { editor?: Editor | null; value?: unknown; className?: string; onFocus?: FocusEventHandler; onBlur?: FocusEventHandler }
>(function EditorInput({ editor = null, value, className, onFocus, onBlur }, ref) {
  useImperativeHandle(ref, () => ({ focus: () => editor?.commands.focus(), value: typeof value === "string" ? value : "" }), [editor, value]);
  return (
    <div className={className} onFocus={onFocus} onBlur={onBlur}>
      <EditorContent editor={editor} />
    </div>
  );
});

/**
 * A thread message being written: plain text, and marked mentions shown as
 * the chips of their items. Typing "#" opens the list of items for marked
 * mentions, of any module, and what follows the "#" narrows it to the items
 * whose name holds it; typing an item's full name without a "#" opens it
 * too. The item whose name is typed in full is highlighted. ↑ and ↓ move the
 * highlight, Enter or Tab accepts it and Esc closes the list; clicking an
 * item accepts it. Accepting replaces the typed text, and its "#", with a
 * marked mention of the item.
 */
const MentionField = observer(function MentionField({
  label,
  autoFocus = false,
  value,
  onChange,
  onKeyDown,
}: {
  label: string;
  autoFocus?: boolean;
  value: MessageDraft | null;
  onChange: (value: MessageDraft) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const { module } = useWorkflowView();
  const nameOf = useItemName();
  const fieldId = useId();
  const listId = useId();
  const field = useRef<HTMLDivElement>(null);
  const controls = useRef<ListControls | null>(null);
  /** The draft this field last gave: any other value is set from outside, such as cleared once sent. */
  const given = useRef(value);
  const [list, setList] = useState<OpenList | null>(null);
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState<{ search: string; index: number } | null>(null);
  const [extensions] = useState(() => [
    Document,
    Paragraph.extend({ addKeyboardShortcuts: () => ({ "Shift-Enter": ({ editor }) => editor.commands.splitBlock() }) }),
    Text,
    UndoRedo,
    Mention.extend({ addNodeView: () => ReactNodeViewRenderer(MentionChip) }).configure({
      deleteTriggerWithBackspace: true,
      renderText: ({ node }) => controls.current?.nameOf(String(node.attrs.id)) ?? "",
      renderHTML: ({ options, node }) => ["span", options.HTMLAttributes, controls.current?.nameOf(String(node.attrs.id)) ?? ""],
      suggestions: [suggestion(true, controls, setList), suggestion(false, controls, setList)],
    }),
  ]);

  const matches = list == null ? [] : matchesOf(list, module.mentionableItems);
  const open = focused && matches.length > 0;
  const shown = matches.slice(0, SHOWN);
  const searchKey = list == null ? "" : `${list.from}:${list.typed}`;
  const exact = list == null ? -1 : shown.findIndex(({ name }) => (list.hash ? name.toLowerCase() === list.typed.toLowerCase() : name === list.typed));
  const highlighted = highlight?.search === searchKey ? highlight.index : Math.max(exact, 0);

  const editor = useEditor({
    extensions,
    content: value,
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: {
        role: "combobox",
        "aria-multiline": "true",
        "aria-labelledby": `${fieldId}-label`,
        "aria-autocomplete": "list",
        "aria-expanded": String(open),
        ...(open ? { "aria-controls": listId, "aria-activedescendant": `${listId}-${highlighted}` } : {}),
      },
    },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onUpdate: ({ editor: updated }) => {
      const draft = updated.getJSON();
      given.current = draft;
      onChange(draft);
    },
  });

  const keyDown = (event: globalThis.KeyboardEvent): boolean => {
    if (!open || list == null) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight({ search: searchKey, index: (highlighted + step + shown.length) % shown.length });
      return true;
    }
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    if ((event.key === "Enter" || event.key === "Tab") && plain) {
      list.accept(shown[highlighted]!);
      return true;
    }
    return false;
  };

  useLayoutEffect(() => {
    controls.current = { items: () => module.mentionableItems, nameOf, keyDown };
  });

  useEffect(() => {
    if (editor == null || value === given.current) return;
    given.current = value;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${highlighted}`)?.scrollIntoView({ block: "nearest" });
  }, [open, highlighted, listId]);

  return (
    <>
      <TextField
        ref={field}
        id={fieldId}
        label={label}
        helperText='Type "#" to mention an item.'
        size="small"
        multiline
        value={messageText(value, nameOf)}
        // A key the editor or its list took is not the field's: Esc that closes the list leaves the thread open.
        onKeyDown={(event) => {
          if (!event.defaultPrevented) onKeyDown?.(event);
        }}
        slotProps={{ input: { inputComponent: EditorInput }, htmlInput: { editor } }}
        sx={{ "& .ProseMirror": { minHeight: "2.875em", outline: "none" }, "& .ProseMirror p": { m: 0 } }}
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
                onClick={() => list?.accept(item)}
              >
                <ItemOption itemId={item.id} />
              </ListItemButton>
            ))}
          </List>
          {matches.length > SHOWN && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 2, pb: 1 }}>
              {matches.length - SHOWN} more: type more of the code to find them.
            </Typography>
          )}
        </Paper>
      </Popper>
    </>
  );
});

export default MentionField;
