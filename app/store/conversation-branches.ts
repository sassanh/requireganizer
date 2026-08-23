import { fingerprint } from "contract-domain";
import { uuid } from "utilities";

/**
 * A kept alternative path of the conversation. When a rewind or a
 * regeneration truncates the active transcript, the removed tail is stored
 * here instead of being destroyed, so it can be switched back to later.
 *
 * `baseLength` is the number of leading messages the tail was cut after, and
 * `baseFingerprint` fingerprints that exact prefix. A record can reattach to
 * the live transcript only while its prefix still matches byte-for-byte —
 * this makes switching exact without storing a parallel tree, and lets
 * unreachable branches surface again once their prefix returns.
 */
export type ConversationBranchRecord = {
  id: string;
  createdAt: number;
  baseLength: number;
  baseFingerprint: string;
  messages: unknown[];
};

export function makeConversationBranchRecord(
  baseMessages: readonly unknown[],
  removedTail: readonly unknown[],
): ConversationBranchRecord {
  return {
    id: uuid(),
    createdAt: Date.now(),
    baseLength: baseMessages.length,
    baseFingerprint: fingerprint(baseMessages),
    messages: [...removedTail],
  };
}

/**
 * A kept tail can reattach only when the live transcript still starts with
 * the exact prefix it branched from.
 */
export function isBranchAttachable(
  record: ConversationBranchRecord,
  conversation: readonly unknown[],
): boolean {
  if (record.baseLength > conversation.length) return false;
  const prefix = conversation.slice(0, record.baseLength);
  return fingerprint(prefix) === record.baseFingerprint;
}

/**
 * The transcript position a (reattachable) branch diverged from — where its
 * fork divider renders.
 */
export function branchForkIndex(record: ConversationBranchRecord): number {
  return record.baseLength;
}

/**
 * A short human label for switcher menus: the first user-visible text found
 * in the kept tail.
 */
export function branchTailPreview(record: ConversationBranchRecord): string {
  for (const entry of record.messages) {
    const role = (entry as { role?: unknown })?.role;
    const content = (entry as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((block) =>
        typeof block === "object" && block != null &&
        (block as { type?: unknown }).type === "text",
      )
      .map((block) => String((block as { text?: unknown }).text ?? ""))
      .join("")
      .trim();
    if (text.length === 0) continue;
    const who = role === "user" ? "You" : role === "assistant" ? "Agent" : "Tool";
    const clipped = text.length > 64 ? `${text.slice(0, 64)}…` : text;
    return `${who}: ${clipped}`;
  }
  return "(kept conversation tail)";
}
