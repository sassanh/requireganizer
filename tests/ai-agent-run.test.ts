import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  AssistantMessage,
  AssistantMessageEvent,
  ToolCall,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

import { runAgentCommand } from "../app/ai-agent/agent";
import { Step } from "../app/store/constants";
import { Store } from "../app/store/store";
import type { FlatStore } from "../app/store/store";

function assistantMessage(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "opencode-zen",
    model: "x-preview-f-free",
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: content.some((block) => block.type === "toolCall")
      ? "toolUse"
      : "stop",
    timestamp: Date.now(),
  };
}

function scriptedStreamFn(responses: AssistantMessage[]) {
  let call = 0;
  return () => {
    const stream = createAssistantMessageEventStream();
    const message = responses[Math.min(call, responses.length - 1)];
    call += 1;
    const events: AssistantMessageEvent[] = [
      { type: "start", partial: message },
      ...message.content.map((block, contentIndex) =>
        block.type === "text"
          ? ({ type: "text_delta", contentIndex, delta: block.text, partial: message } as AssistantMessageEvent)
          : ({ type: "toolcall_end", contentIndex, toolCall: block as ToolCall, partial: message } as AssistantMessageEvent),
      ),
      {
        type: "done",
        reason: message.stopReason as "stop" | "toolUse",
        message,
      },
    ];
    queueMicrotask(() => {
      for (const event of events) stream.push(event);
    });
    return stream;
  };
}

describe("agent command run", () => {
  it("applies a tool-call proposal to the store and persists the transcript", async () => {
    const store = Store.create({ productOverview: {} }) as unknown as FlatStore;
    store.setDescription({ description: "A houseplant companion." });

    const toolCall: ToolCall = {
      type: "toolCall",
      id: "call-1",
      name: "submit_product_overview",
      arguments: {
        name: "Plant Pal",
        purpose: "Help people keep houseplants alive.",
        primaryFeatures: ["Track watering schedules"],
        targetUsers: ["Busy plant owners"],
      },
    };

    await runAgentCommand(
      store,
      "generate the product overview",
      { kind: "generate", stage: Step.ProductOverview },
      scriptedStreamFn([
        assistantMessage([toolCall]),
        assistantMessage([{ type: "text", text: "Product overview applied." }]),
      ]),
    );

    assert.equal(store.productOverview.name, "Plant Pal");
    assert.equal(store.productOverview.purpose, "Help people keep houseplants alive.");
    assert.ok(store.conversation.length >= 4);
    const recorded = store.providerCalls.at(-1);
    assert.ok(recorded != null);
    assert.equal(recorded.outcome, "success");
    assert.equal(recorded.usage?.totalTokens, 30);
  });

  it("reports provider failures through the flow error path", async () => {
    const store = Store.create({ productOverview: {} }) as unknown as FlatStore;
    const failing = assistantMessage([]);
    failing.stopReason = "error";
    failing.errorMessage = "The gateway is unavailable.";

    await assert.rejects(
      () => runAgentCommand(
        store,
        "generate the product overview",
        { kind: "generate", stage: Step.ProductOverview },
        scriptedStreamFn([failing]),
      ),
      /gateway is unavailable/,
    );
    const recorded = store.providerCalls.at(-1);
    assert.equal(recorded?.outcome, "failed");
  });
});
