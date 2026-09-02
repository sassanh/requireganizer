import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { injectReasoningTextDeltas } from "../app/ai-agent/reasoning-sse";
import {
  disclosedThinking,
  hydrateConversationThinking,
  reasoningTextFromEvent,
} from "../app/ai-agent/thinking";
import { Store } from "../app/store/store";

describe("disclosed thinking", () => {
  it("reads thinking text from the block", () => {
    assert.equal(
      disclosedThinking({ type: "thinking", thinking: "  because the seed is a calculator  " }),
      "because the seed is a calculator",
    );
  });

  it("reads a reasoning summary trapped on the signature", () => {
    assert.equal(
      disclosedThinking({
        type: "thinking",
        thinking: "",
        thinkingSignature: JSON.stringify({
          type: "reasoning",
          id: "rs_1",
          summary: [{ type: "summary_text", text: "Parents are out of scope." }],
          encrypted_content: "opaque",
        }),
      }),
      "Parents are out of scope.",
    );
  });

  it("reads reasoning_text content trapped on the signature", () => {
    assert.equal(
      disclosedThinking({
        type: "thinking",
        thinkingSignature: JSON.stringify({
          type: "reasoning",
          content: [{ type: "reasoning_text", text: "Call submit after reading artifacts." }],
        }),
      }),
      "Call submit after reading artifacts.",
    );
  });

  it("does not treat encrypted_content as thinking text", () => {
    assert.equal(
      disclosedThinking({
        type: "thinking",
        thinking: "",
        thinkingSignature: JSON.stringify({
          type: "reasoning",
          summary: [],
          encrypted_content: "gAAAAA-not-human-readable",
        }),
      }),
      "",
    );
  });
});

describe("hydrateConversationThinking", () => {
  it("copies signature text onto empty thinking blocks", () => {
    const [message] = hydrateConversationThinking([
      {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "",
            thinkingSignature: JSON.stringify({
              summary: [{ type: "summary_text", text: "Unlock the submit tool." }],
            }),
          },
          { type: "toolCall", id: "call-1", name: "activate_stage_result_tool", arguments: {} },
        ],
      },
    ]);
    const block = (message as { content: { thinking?: string }[] }).content[0];
    assert.equal(block.thinking, "Unlock the submit tool.");
  });

  it("fills thinking when the conversation is stored", () => {
    const store = Store.create({ productOverview: {} });
    store.setConversation([
      {
        role: "assistant",
        content: [{
          type: "thinking",
          thinking: "",
          thinkingSignature: JSON.stringify({
            content: [{ type: "reasoning_text", text: "Read the current overview first." }],
          }),
        }],
      },
    ]);
    const message = store.conversation[0] as { content: { thinking?: string }[] };
    assert.equal(message.content[0].thinking, "Read the current overview first.");
  });
});

describe("reasoningTextFromEvent", () => {
  it("extracts reasoning_text from content_part.done", () => {
    assert.deepEqual(
      reasoningTextFromEvent({
        type: "response.content_part.done",
        output_index: 2,
        part: { type: "reasoning_text", text: "Need the workflow state." },
      }),
      { outputIndex: 2, text: "Need the workflow state." },
    );
  });

  it("extracts a summary already present on output_item.added", () => {
    assert.deepEqual(
      reasoningTextFromEvent({
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "The user removed parents." }],
        },
      }),
      { outputIndex: 0, text: "The user removed parents." },
    );
  });

  it("extracts full text from reasoning_text.done", () => {
    assert.deepEqual(
      reasoningTextFromEvent({
        type: "response.reasoning_text.done",
        output_index: 0,
        text: "Check the boundary first.",
      }),
      { outputIndex: 0, text: "Check the boundary first." },
    );
  });

  it("extracts full text from reasoning_summary_text.done", () => {
    assert.deepEqual(
      reasoningTextFromEvent({
        type: "response.reasoning_summary_text.done",
        output_index: 1,
        text: "Summarize the plan.",
      }),
      { outputIndex: 1, text: "Summarize the plan." },
    );
  });

  it("ignores function_call items", () => {
    assert.equal(
      reasoningTextFromEvent({
        type: "response.output_item.added",
        output_index: 1,
        item: { type: "function_call", name: "submit_product_overview" },
      }),
      null,
    );
  });
});

describe("injectReasoningTextDeltas", () => {
  it("emits a reasoning_text.delta after content_part.done", async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(
          "data: {\"type\":\"response.content_part.done\",\"output_index\":0,\"part\":{\"type\":\"reasoning_text\",\"text\":\"Read artifacts first.\"}}\n\n",
        ));
        controller.close();
      },
    });
    const output = injectReasoningTextDeltas(source);
    const text = await new Response(output).text();
    assert.match(text, /response\.content_part\.done/);
    assert.match(text, /response\.reasoning_text\.delta/);
    assert.match(text, /Read artifacts first/);
  });
});
