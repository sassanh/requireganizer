import { wordDiff } from "components/wordDiff";

// Characters no writer types, which open and close the words a change added or removed.
const INSERT_START = "";
const INSERT_END = "";
const DELETE_START = "";
const DELETE_END = "";
const MARK = /^[-]$/;

/** What opens a line as a block, such as a list item's marker or a heading's, which a mark must follow to keep the line that block. */
const BLOCK_OPENING = /^\s*(?:(?:[-*+]|\d+[.)]|#{1,6}|>)\s+)?/;

/** A line marked whole as added or removed, after what opens it as a block. */
function markedLine(line: string, start: string, end: string): string {
  const opening = BLOCK_OPENING.exec(line)![0];
  const rest = line.slice(opening.length);
  return rest.length === 0 ? line : `${opening}${start}${rest}${end}`;
}

/** One line in two versions, word by word. */
function markedWords(before: string, after: string): string {
  return wordDiff(before, after)
    .map((hunk) => (hunk.kind === "insert" ? markedLine(hunk.text, INSERT_START, INSERT_END) : hunk.kind === "delete" ? markedLine(hunk.text, DELETE_START, DELETE_END) : hunk.text))
    .join("");
}

/** The lines both versions keep, as pairs of their places, in order: a longest common subsequence. */
function keptLines(before: readonly string[], after: readonly string[]): [number, number][] {
  const lengths = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0));
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lengths[i]![j] = before[i] === after[j] ? lengths[i + 1]![j + 1]! + 1 : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const kept: [number, number][] = [];
  for (let i = 0, j = 0; i < before.length && j < after.length; ) {
    if (before[i] === after[j]) {
      kept.push([i, j]);
      i += 1;
      j += 1;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) i += 1;
    else j += 1;
  }
  return kept;
}

/**
 * Two versions of a Markdown text as one, marked for `rehypeChangeMarks`.
 * Lines are matched first, so a mark never crosses a line and each line
 * keeps the block it opens: a line only one version holds is marked whole,
 * and lines changed in place are compared word by word.
 */
export function markedDiff(before: string, after: string): string {
  const old = before.split("\n");
  const now = after.split("\n");
  const lines: string[] = [];
  let i = 0;
  let j = 0;
  for (const [keptBefore, keptAfter] of [...keptLines(old, now), [old.length, now.length] as [number, number]]) {
    const removed = old.slice(i, keptBefore);
    const added = now.slice(j, keptAfter);
    const paired = Math.min(removed.length, added.length);
    for (let index = 0; index < paired; index += 1) lines.push(markedWords(removed[index]!, added[index]!));
    for (const line of removed.slice(paired)) lines.push(markedLine(line, DELETE_START, DELETE_END));
    for (const line of added.slice(paired)) lines.push(markedLine(line, INSERT_START, INSERT_END));
    if (keptBefore < old.length) lines.push(old[keptBefore]!);
    i = keptBefore + 1;
    j = keptAfter + 1;
  }
  return lines.join("\n");
}

interface TextNode {
  type: "text";
  value: string;
}

interface ParentNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: (TextNode | ParentNode)[];
}

/**
 * Wrap each run of text that `markedDiff` marked as added in an `ins` and
 * as removed in a `del`, in document order, so that a change spanning
 * emphasis or code marks each piece of text it holds.
 */
export function rehypeChangeMarks() {
  return (tree: ParentNode) => {
    let open: "ins" | "del" | null = null;
    const walk = (node: ParentNode) => {
      if (node.children == null) return;
      node.children = node.children.flatMap((child): (TextNode | ParentNode)[] => {
        if (child.type !== "text") {
          walk(child as ParentNode);
          return [child];
        }
        const pieces: (TextNode | ParentNode)[] = [];
        for (const part of (child as TextNode).value.split(/([-])/)) {
          if (MARK.test(part)) {
            open = part === INSERT_START ? "ins" : part === DELETE_START ? "del" : null;
          } else if (part.length > 0) {
            const text: TextNode = { type: "text", value: part };
            pieces.push(open == null ? text : { type: "element", tagName: open, properties: {}, children: [text] });
          }
        }
        return pieces;
      });
    };
    walk(tree);
  };
}
