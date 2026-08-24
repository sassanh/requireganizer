import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  AssistantMessage,
  AssistantMessageEvent,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

import { Store } from "../app/store/store";
import type { Store as StoreInstance } from "../app/store/store";
import {
  attachTimeline,
  canRedo,
  canUndo,
  commitTimelineSegment,
  flushTimeline,
  jumpToNode,
  redo,
  timelineCursor,
  timelineEntries,
  undo,
} from "../app/store/timeline/controller";
import type { PersistedTimeline } from "../app/store/timeline/serialize";
import {
  artifactCount,
  captureNode,
  restoreNode,
} from "../app/store/timeline/serialize";

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
    stopReason: "stop",
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
          : ({ type: "toolcall_end", contentIndex, toolCall: block as never, partial: message } as AssistantMessageEvent),
      ),
      { type: "done", reason: "stop", message } as AssistantMessageEvent,
    ];
    queueMicrotask(() => {
      for (const event of events) stream.push(event);
    });
    return stream;
  };
}

function snapshotOf(store: StoreInstance): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify({
      schemaVersion: store.schemaVersion,
      isClean: store.isClean,
      businessCounter: store.businessCounter,
      description: store.description,
      productOverview: store.productOverview,
      userStories: store.userStories,
      requirements: store.requirements,
      acceptanceCriteria: store.acceptanceCriteria,
      boundaryDesign: store.boundaryDesign,
      implementationProfile: store.implementationProfile,
      contractSuite: store.contractSuite,
      testScenarios: store.testScenarios,
      projectSetup: store.projectSetup,
      scaffoldFiles: store.scaffoldFiles,
      stageInputFingerprints: Object.fromEntries(store.stageInputFingerprints),
      conversation: store.conversation,
      conversationBranches: store.conversationBranches ?? [],
    }),
  ) as Record<string, unknown>;
}

describe("timeline serialization", () => {
  it("round-trips a store snapshot through capture/restore", () => {
    const store = Store.create({ productOverview: {} }) as unknown as StoreInstance;
    store.setDescription({ description: "A calculator." });
    store.setConversation([
      { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "hi" }], timestamp: 2 },
    ]);

    const before = snapshotOf(store);
    const node = captureNode(before as never, {
      id: "n1",
      label: "test",
      source: "user",
      createdAt: 1,
    });
    const restored = restoreNode(node, {
      validationErrors: "keep me",
      systemMessage: null,
      conversationSidebarOpen: true,
    } as never) as Record<string, unknown>;

    assert.equal(restored.description, before.description);
    assert.deepEqual(restored.conversation, before.conversation);
    assert.deepEqual(restored.requirements, before.requirements);
    // Ephemeral fields survive restores from the current snapshot.
    assert.equal(restored.validationErrors, "keep me");
    assert.equal(restored.conversationSidebarOpen, true);
  });

  it("stores identical artifacts once; adjacent nodes share hashes", () => {
    const snapshot = {
      schemaVersion: 2,
      isClean: true,
      businessCounter: 0,
      description: "same description",
      productOverview: { name: "App", purpose: null, primaryFeatures: [], targetUsers: [] },
      userStories: [{ id: "us-1", content: "story" }],
      requirements: [] as unknown[],
      acceptanceCriteria: [] as unknown[],
      boundaryDesign: null,
      implementationProfile: null,
      contractSuite: null,
      testScenarios: [] as unknown[],
      projectSetup: null,
      scaffoldFiles: [] as unknown[],
      stageInputFingerprints: {},
      conversation: [
        { role: "user", content: [{ type: "text", text: "q" }], timestamp: 1 },
      ],
      conversationBranches: [] as unknown[],
    };

    const nodeA = captureNode(snapshot as never, {
      id: "a",
      label: "a",
      source: "user",
      createdAt: 1,
    });
    const countAfterA = artifactCount();

    // A changed description only: every other hash is shared with node A.
    const changed = { ...snapshot, description: "same description v2" };
    const nodeB = captureNode(changed as never, {
      id: "b",
      label: "b",
      source: "user",
      createdAt: 2,
    });

    assert.notEqual(nodeA.state.description, nodeB.state.description);
    assert.deepEqual(nodeB.state.userStories, nodeA.state.userStories);
    assert.deepEqual(nodeB.state.conversation, nodeA.state.conversation);
    // Exactly one new artifact (the changed description) was stored.
    assert.equal(artifactCount() - countAfterA, 1);
    assert.ok(nodeB.state.description.length <= 20);
  });
});

describe("timeline controller", () => {
  function newStore(): StoreInstance {
    const store = Store.create({ productOverview: {} }) as unknown as StoreInstance;
    attachTimeline(store);
    return store;
  }

  it("records one node per top-level action and supports undo/redo", () => {
    const store = newStore();
    assert.equal(timelineEntries().length, 1);
    assert.equal(canUndo(), false);

    store.setDescription({ description: "first" });
    commitTimelineSegment();
    assert.equal(timelineEntries().length, 2);
    assert.equal(canUndo(), true);

    store.setDescription({ description: "second" });
    commitTimelineSegment();
    assert.equal(timelineEntries().length, 3);

    undo();
    assert.equal(store.description, "first");
    assert.equal(canRedo(), true);

    redo();
    assert.equal(store.description, "second");
    assert.equal(canRedo(), false);

    undo();
    undo();
    assert.equal(store.description, "");
    assert.equal(canUndo(), false);
  });

  it("coalesces same-path text edits but splits after a commit", () => {
    const store = newStore();
    const base = timelineEntries().length;

    store.setDescription({ description: "a" });
    store.setDescription({ description: "ab" });
    store.setDescription({ description: "abc" });
    assert.equal(timelineEntries().length, base + 1);
    assert.equal(store.description, "abc");

    commitTimelineSegment();
    store.setDescription({ description: "abcd" });
    assert.equal(timelineEntries().length, base + 2);

    undo();
    assert.equal(store.description, "abc");
  });

  it("records an AI flow as a single node and undo reverts its conversation", async () => {
    const store = newStore();
    const base = timelineEntries().length;

    await store.sendConversationMessage(
      { message: "hello agent" },
      scriptedStreamFn([assistantMessage([{ type: "text", text: "hi there" }])]),
    );

    const entries = timelineEntries();
    assert.equal(entries.length, base + 1);
    const last = entries[entries.length - 1];
    assert.equal(last.source, "ai");
    assert.match(last.label, /answer the conversation/);
    assert.ok(store.conversation.length >= 2);

    undo();
    assert.equal(store.conversation.length, 0);
    redo();
    assert.ok(store.conversation.length >= 2);
  });

  it("jumps to an arbitrary node", () => {
    const store = newStore();
    store.setDescription({ description: "one" });
    commitTimelineSegment();
    store.setDescription({ description: "two" });
    commitTimelineSegment();
    store.setDescription({ description: "three" });
    commitTimelineSegment();

    jumpToNode(1);
    assert.equal(store.description, "one");

    jumpToNode(timelineCursor() + 1);
    assert.equal(store.description, "two");
  });

  it("persists the timeline and restores it on a later attach", () => {
    let stored: PersistedTimeline | null = null;
    const persistence = {
      load: () => stored,
      save: (data: PersistedTimeline) => {
        stored = JSON.parse(JSON.stringify(data)) as PersistedTimeline;
        return true;
      },
    };

    const store = Store.create({ productOverview: {} }) as unknown as StoreInstance;
    attachTimeline(store, { persistence });
    store.setDescription({ description: "v1" });
    commitTimelineSegment();
    store.setDescription({ description: "v2" });
    commitTimelineSegment();
    flushTimeline();

    // Simulate a reload: a brand-new store instance hydrated from the
    // project autosave, which holds the latest description.
    const reloaded = Store.create({
      productOverview: {},
      description: "v2",
    }) as unknown as StoreInstance;
    attachTimeline(reloaded, { persistence });

    assert.equal(reloaded.description, "v2");
    assert.equal(canUndo(), true);

    // Undo reaches across the reload boundary into pre-reload history.
    undo();
    assert.equal(reloaded.description, "v1");
    redo();
    assert.equal(reloaded.description, "v2");
  });

  it("starts fresh when the persisted timeline is malformed", () => {
    const persistence = {
      load: () => ({ version: 1, cursor: 0, nodes: "garbage", artifacts: [] }),
      save: () => true,
    };

    const store = Store.create({ productOverview: {} }) as unknown as StoreInstance;
    attachTimeline(store, { persistence });

    assert.equal(timelineEntries().length, 1);
    assert.equal(canUndo(), false);
  });

  it("trims history instead of throwing when persistence quota is exceeded", () => {
    const persistence = {
      load: () => null,
      save: () => false,
    };

    const store = Store.create({ productOverview: {} }) as unknown as StoreInstance;
    attachTimeline(store, { persistence });
    for (let index = 0; index < 30; index += 1) {
      store.setDescription({ description: `value ${index}` });
      commitTimelineSegment();
    }

    flushTimeline();
    assert.ok(timelineEntries().length <= 21);
  });
});
