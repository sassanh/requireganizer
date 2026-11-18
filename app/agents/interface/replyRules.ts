/** How an agent writes a marked mention, and what it is. */
export const MENTION_MARKUP_TEXT =
  "A marked mention ties a part of a reply to one item: write it [CODE](item:ID), with the item's code and id as get_items gives them, or [Module name/CODE](item:ID) for an item of another module than the thread's, whose code and id get_items gives when passed that module. The spec owner sees it by the item's code at the time they read it, with a preview and a way to open it; a code written outside a marked mention is plain text, tied to no item. A reply holding a marked mention whose code names no item, or another item than its id, is refused. In a reply sent with write_items, mark an item the write adds as [](change:N), N being the place of its add change among the changes, counting from 1; the spec owner sees it by the code the item gets. A reply is refused if N is not among its changes or that change adds no item.";

/** The rules every reply of an agent follows. */
export const REPLY_RULES: readonly string[] = [
  "it speaks only to its thread's request;",
  "it makes sense read on its own;",
  "it gives an item's code only inside a marked mention of that item; and",
  "it names each item that no longer exists when the reply is sent by what the item said, never by a code.",
];

/** The reply rules and the mention markup as one text, for an agent. */
export function replyRulesText(): string {
  return `Each reply follows these rules: ${REPLY_RULES.join(" ")} ${MENTION_MARKUP_TEXT}`;
}
