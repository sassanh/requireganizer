import {
  reasoningTextDeltaEvent,
  reasoningTextFromEvent,
} from "./thinking";

function parseSseData(block: string): unknown | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^\s/, ""))
    .join("\n");
  if (data.length === 0 || data === "[DONE]") return null;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

function encodeSseData(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function splitSseBlocks(buffer: string): { blocks: string[]; rest: string } {
  const blocks: string[] = [];
  let rest = buffer;
  for (;;) {
    const separator = rest.search(/\r?\n\r?\n/);
    if (separator < 0) break;
    const match = rest.slice(separator).match(/^\r?\n\r?\n/);
    const skip = match?.[0].length ?? 2;
    const block = rest.slice(0, separator);
    rest = rest.slice(separator + skip);
    if (block.trim().length > 0) blocks.push(block);
  }
  return { blocks, rest };
}

/**
 * Rewrite a Responses SSE body so complete reasoning text that arrived on
 * `content_part` / `output_item` / `reasoning_*_text.done` events — all of
 * which pi-ai otherwise drops — is also emitted as
 * `response.reasoning_text.delta`, which pi-ai copies onto thinking blocks.
 */
export function injectReasoningTextDeltas(
  body: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const seen = new Map<number, string>();
  let buffer = "";

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const { blocks, rest } = splitSseBlocks(buffer);
        buffer = rest;
        for (const block of blocks) {
          controller.enqueue(encoder.encode(`${block}\n\n`));
          const extracted = reasoningTextFromEvent(parseSseData(block));
          if (extracted == null) continue;
          const previous = seen.get(extracted.outputIndex) ?? "";
          let delta = "";
          if (previous.length === 0) {
            delta = extracted.text;
          } else if (
            extracted.text.startsWith(previous)
            && extracted.text.length > previous.length
          ) {
            delta = extracted.text.slice(previous.length);
          }
          if (delta.length === 0) continue;
          seen.set(extracted.outputIndex, extracted.text);
          controller.enqueue(
            encoder.encode(encodeSseData(
              reasoningTextDeltaEvent(extracted.outputIndex, delta),
            )),
          );
        }
      },
      flush(controller) {
        if (buffer.trim().length > 0) {
          controller.enqueue(encoder.encode(buffer));
        }
      },
    }),
  );
}

export async function fetchWithReasoningTextBridge(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);
  if (response.body == null) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) return response;
  return new Response(injectReasoningTextDeltas(response.body), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
