import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentMessage, AgentOptions } from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  ToolCall,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

import { runAgentCommand } from "../app/ai-agent/agent";
import { describeError } from "../app/store/actions/ai-actions/utilities";
import { Step } from "../app/store/constants";
import { branchTailPreview } from "../app/store/conversation-branches";
import { Store } from "../app/store/store";
import type { FlatStore, Store as StoreInstance } from "../app/store/store";

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
  const seenToolNames: string[][] = [];
  const streamFn: NonNullable<AgentOptions["streamFn"]> = (_model, context) => {
    seenToolNames.push((context.tools ?? []).map((tool) => tool.name));
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
  return Object.assign(streamFn, { seenToolNames });
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

  it("leads error details with the failure reason before the stack", async () => {
    const leaf = new Error("503 status code (no body)");
    const wrapped = new Error("The AI request failed.", { cause: leaf });

    const described = describeError(wrapped);

    assert.match(described, /^Error: The AI request failed\./);
    assert.match(described, /Caused by: 503 status code \(no body\)/);
    // The reason must appear before any stack frames.
    assert.ok(described.indexOf("Caused by:") < described.indexOf("    at "));
  });
});

describe("conversation history", () => {
  function userMessage(text: string): AgentMessage {
    return {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    } as AgentMessage;
  }

  type TranscriptEntry = { role: string; content: unknown };

  function transcriptTexts(store: FlatStore): string[] {
    return (store.conversation as TranscriptEntry[]).map((message) => {
      const blocks = (Array.isArray(message.content) ? message.content : []) as
        { type?: string; text?: string }[];
      const text = blocks
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("");
      return `${message.role}: ${text}`;
    });
  }

  it("branches from a rewound point, dropping the anchor turn and everything after", async () => {
    const store = Store.create({ productOverview: {} }) as unknown as StoreInstance;
    store.setConversation([
      userMessage("first question"),
      assistantMessage([{ type: "text", text: "first answer" }]),
      userMessage("second question"),
      assistantMessage([{ type: "text", text: "second answer" }]),
    ]);

    await store.branchFromMessage(
      { index: 2, message: "redone second question" },
      scriptedStreamFn([assistantMessage([{ type: "text", text: "redone answer" }])]),
    );

    assert.deepEqual(transcriptTexts(store), [
      "user: first question",
      "assistant: first answer",
      "user: redone second question",
      "assistant: redone answer",
    ]);
  });

  it("regenerates the last reply without duplicating the user turn", async () => {
    const store = Store.create({ productOverview: {} }) as unknown as StoreInstance;
    store.setConversation([
      userMessage("only question"),
      assistantMessage([{ type: "text", text: "stale answer" }]),
    ]);

    await store.regenerateLastReply(
      scriptedStreamFn([assistantMessage([{ type: "text", text: "fresh answer" }])]),
    );

    assert.deepEqual(transcriptTexts(store), [
      "user: only question",
      "assistant: fresh answer",
    ]);
  });

  it("keeps a branched-off tail and switches back to it losslessly", async () => {
    const store = Store.create({ productOverview: {} }) as unknown as StoreInstance;
    store.setConversation([
      userMessage("first question"),
      assistantMessage([{ type: "text", text: "first answer" }]),
      userMessage("second question"),
      assistantMessage([{ type: "text", text: "second answer" }]),
    ]);

    await store.branchFromMessage(
      { index: 2, message: "redo second" },
      scriptedStreamFn([assistantMessage([{ type: "text", text: "redo answer" }])]),
    );

    const records = store.conversationBranches ?? [];
    assert.equal(records.length, 1);
    assert.equal(records[0].baseLength, 2);
    assert.match(branchTailPreview(records[0]), /second question/);

    await store.switchConversationBranch({ id: records[0].id });

    assert.deepEqual(transcriptTexts(store), [
      "user: first question",
      "assistant: first answer",
      "user: second question",
      "assistant: second answer",
    ]);
    // The abandoned redo tail became its own sibling at the same fork.
    assert.equal((store.conversationBranches ?? []).length, 2);
  });

  it("refuses to switch to a branch whose prefix has drifted", async () => {
    const store = Store.create({ productOverview: {} }) as unknown as StoreInstance;
    store.setConversation([
      userMessage("only question"),
      assistantMessage([{ type: "text", text: "stale answer" }]),
    ]);

    await store.regenerateLastReply(
      scriptedStreamFn([assistantMessage([{ type: "text", text: "fresh answer" }])]),
    );

    const records = store.conversationBranches ?? [];
    assert.equal(records.length, 1);
    assert.equal(records[0].baseLength, 1);

    // The transcript moves on; the kept tail's prefix no longer exists.
    store.setConversation([userMessage("a different history")]);

    await store.switchConversationBranch({ id: records[0].id });
    assert.match(store.validationErrors ?? "", /diverged/);
  });

  it("refuses to regenerate an empty conversation through the validation path", async () => {
    const store = Store.create({ productOverview: {} }) as unknown as StoreInstance;

    await store.regenerateLastReply(scriptedStreamFn([]));

    assert.match(store.validationErrors ?? "", /nothing to regenerate/i);
  });

  it("keeps an interrupted stage's result tool available across plain conversation turns", async () => {
    const store = Store.create({ productOverview: {} }) as unknown as StoreInstance;
    const commandText = JSON.stringify({ kind: "generate", stage: Step.ProductOverview });
    const deadAttempt = assistantMessage([]);
    deadAttempt.stopReason = "error";
    store.setConversation([userMessage(commandText), deadAttempt]);

    const scripted = scriptedStreamFn([
      assistantMessage([{ type: "text", text: "noted." }]),
    ]);
    await store.sendConversationMessage({ message: "continue" }, scripted);

    // The pending command's result tool must still be offered next to the
    // plain conversation tools, or the model can never finish the stage.
    assert.ok(scripted.seenToolNames.at(-1)?.includes("submit_product_overview"));
    assert.ok(scripted.seenToolNames.at(-1)?.includes("communicate"));
    assert.ok(scripted.seenToolNames.at(-1)?.includes("get_workflow_state"));
  });

  it("replaces a failed duplicate command instead of appending another copy", async () => {
    const store = Store.create({ productOverview: {} }) as unknown as StoreInstance;
    const command = { kind: "generate", stage: Step.ProductOverview } as const;
    const commandText = JSON.stringify(command);
    const deadAttempt = assistantMessage([]);
    deadAttempt.stopReason = "error";
    store.setConversation([userMessage(commandText), deadAttempt]);

    await runAgentCommand(
      store,
      "generate the product overview",
      command,
      scriptedStreamFn([
        assistantMessage([
          {
            type: "toolCall",
            id: "call-1",
            name: "submit_product_overview",
            arguments: {
              name: "Plant Pal",
              purpose: "Help people keep houseplants alive.",
              primaryFeatures: ["Track watering schedules"],
              targetUsers: ["Busy plant owners"],
            },
          },
        ]),
        assistantMessage([{ type: "text", text: "Product overview applied." }]),
      ]),
    );

    assert.equal(
      transcriptTexts(store).filter((entry) => entry === `user: ${commandText}`).length,
      1,
    );
    assert.deepEqual(transcriptTexts(store).slice(-1), [
      "assistant: Product overview applied.",
    ]);
  });
});
