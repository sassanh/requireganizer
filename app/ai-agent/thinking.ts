/**
 * Disclosed thinking text for a conversation block.
 *
 * The Responses API stores a thinking block for every reasoning item so
 * encrypted replay can round-trip. The visible summary/content is often
 * only on `thinkingSignature` (the serialized reasoning item), or arrives
 * as `content_part` events that pi-ai does not copy onto `thinking`.
 */

export type ThinkingBlock = {
  type?: string;
  thinking?: unknown;
  text?: unknown;
  thinkingSignature?: unknown;
};

function textFromUnknown(value: unknown, depth = 0): string {
  if (depth > 4 || value == null) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => textFromUnknown(item, depth + 1))
      .filter((part) => part.length > 0)
      .join("\n\n");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return textFromUnknown(record.text ?? record.thinking, depth + 1)
      || textFromUnknown(record.summary, depth + 1)
      || textFromUnknown(record.content, depth + 1);
  }
  return "";
}

function textFromSignature(signature: unknown): string {
  if (typeof signature !== "string" || signature.length === 0) return "";
  try {
    const item = JSON.parse(signature) as unknown;
    if (item == null || typeof item !== "object") return "";
    const record = item as Record<string, unknown>;
    return textFromUnknown(record.summary) || textFromUnknown(record.content);
  } catch {
    return "";
  }
}

export function disclosedThinking(block: ThinkingBlock): string {
  return textFromUnknown(block.thinking)
    || textFromUnknown(block.text)
    || textFromSignature(block.thinkingSignature);
}

export function hydrateConversationThinking(messages: unknown[]): unknown[] {
  return messages.map((message) => {
    if (message == null || typeof message !== "object") return message;
    const record = message as { content?: unknown };
    if (!Array.isArray(record.content)) return message;
    let changed = false;
    const content = record.content.map((block) => {
      if (block == null || typeof block !== "object") return block;
      const item = block as ThinkingBlock & Record<string, unknown>;
      if (item.type !== "thinking") return block;
      const text = disclosedThinking(item);
      if (text.length === 0 || item.thinking === text) return block;
      changed = true;
      return { ...item, thinking: text };
    });
    return changed ? { ...record, content } : message;
  });
}

/** Pull already-complete reasoning text off a raw Responses SSE event. */
export function reasoningTextFromEvent(event: unknown): {
  outputIndex: number;
  text: string;
} | null {
  if (event == null || typeof event !== "object") return null;
  const record = event as Record<string, unknown>;
  const outputIndex = record.output_index;
  if (typeof outputIndex !== "number") return null;

  if (
    record.type === "response.content_part.added"
    || record.type === "response.content_part.done"
  ) {
    const part = record.part;
    if (part != null && typeof part === "object") {
      const partRecord = part as Record<string, unknown>;
      if (partRecord.type === "reasoning_text") {
        const text = textFromUnknown(partRecord.text);
        if (text.length > 0) return { outputIndex, text };
      }
    }
  }

  if (
    record.type === "response.reasoning_text.done"
    || record.type === "response.reasoning_summary_text.done"
  ) {
    const text = textFromUnknown(record.text);
    if (text.length > 0) return { outputIndex, text };
  }

  if (
    (record.type === "response.output_item.added"
      || record.type === "response.output_item.done")
    && record.item != null
    && typeof record.item === "object"
  ) {
    const item = record.item as Record<string, unknown>;
    if (item.type === "reasoning") {
      const text = textFromUnknown(item.summary) || textFromUnknown(item.content);
      if (text.length > 0) return { outputIndex, text };
    }
  }

  return null;
}

export function reasoningTextDeltaEvent(
  outputIndex: number,
  delta: string,
): Record<string, unknown> {
  return {
    type: "response.reasoning_text.delta",
    output_index: outputIndex,
    delta,
  };
}
