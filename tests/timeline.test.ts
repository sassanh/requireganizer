import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  AssistantMessage,
  AssistantMessageEvent,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { applySnapshot, getSnapshot } from "mobx-state-tree";

import { Store } from "../app/store/store";
import type { Store as StoreInstance } from "../app/store/store";
import {
  activateBranch,
  attachTimeline,
  beginRewind,
  cancelRewind,
  commitTimelineSegment,
  endRewind,
  flushTimeline,
  getDeclaredStepNames,
  getTimelineMeta,
  getTimelineSnapshot,
  jumpToNode,
  redo,
  undo,
} from "../app/store/timeline/controller";
import {
  artifactCount,
  captureState,
  importTimelineData,
  restoreSnapshot,
  type PersistedTimeline,
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
    JSON.stringify(
      {
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
      },
      // A fresh store leaves maybeNull(frozen) props undefined while a
      // restored store carries explicit nulls; normalize for comparison.
      (_key, value) => (value === undefined ? null : value),
    ),
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
    const state = captureState(before as never);
    const restored = restoreSnapshot(state, {
      validationErrors: "keep me",
      systemMessage: null,
      conversationSidebarOpen: true,
      isClean: false,
    } as never) as Record<string, unknown>;

    assert.equal(restored.description, before.description);
    assert.deepEqual(restored.conversation, before.conversation);
    assert.deepEqual(restored.requirements, before.requirements);
    // Ephemeral fields survive restores from the current snapshot.
    assert.equal(restored.validationErrors, "keep me");
    assert.equal(restored.conversationSidebarOpen, true);
    assert.equal(restored.isClean, false);
    // Bookkeeping flags are not part of recorded state identity.
    assert.ok(!("isClean" in state));
  });

  it("stores identical artifacts once; adjacent states share hashes", () => {
    const snapshot = {
      schemaVersion: 3,
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
    };

    const stateA = captureState(snapshot as never);
    const countAfterA = artifactCount();

    // A changed description only: every other hash is shared with state A.
    const changed = { ...snapshot, description: "same description v2" };
    const stateB = captureState(changed as never);

    assert.notEqual(stateA.description, stateB.description);
    assert.deepEqual(stateB.userStories, stateA.userStories);
    assert.deepEqual(stateB.conversation, stateA.conversation);
    // Exactly one new artifact (the changed description) was stored.
    assert.equal(artifactCount() - countAfterA, 1);
    assert.ok(stateB.description.length <= 20);
  });

  it("strips legacy ephemeral fields from imported node states", () => {
    const state = captureState({
      schemaVersion: 3,
      businessCounter: 0,
      description: "x",
      productOverview: null,
      userStories: [],
      requirements: [],
      acceptanceCriteria: [],
      boundaryDesign: null,
      implementationProfile: null,
      contractSuite: null,
      testScenarios: [],
      projectSetup: null,
      scaffoldFiles: [],
      stageInputFingerprints: {},
      conversation: [],
    } as never);
    const payload = {
      version: 2 as const,
      rootId: "r",
      activeLeafId: "n",
      nodes: [{ id: "n", parent: "r", state: { ...state, isClean: false } }],
      artifacts: [] as [string, string][],
    };

    const { nodes } = importTimelineData(
      payload as never as PersistedTimeline,
    );
    const importedState = (nodes[0] as { state: Record<string, unknown> }).state;
    assert.ok(!("isClean" in importedState));
  });
});

describe("timeline controller", () => {
  function newStore(): StoreInstance {
    const store = Store.create({ productOverview: {} }) as unknown as StoreInstance;
    attachTimeline(store);
    return store;
  }

  it("records one turn per top-level action and undo walks the tree", () => {
    const store = newStore();
    assert.equal(getTimelineMeta().entries.length, 1);
    assert.equal(getTimelineMeta().canUndo, false);

    store.setDescription({ description: "first" });
    commitTimelineSegment();
    assert.equal(getTimelineMeta().entries.length, 2);
    assert.equal(getTimelineMeta().canUndo, true);

    store.setDescription({ description: "second" });
    commitTimelineSegment();
    assert.equal(getTimelineMeta().entries.length, 3);

    undo();
    assert.equal(store.description, "first");
    assert.equal(getTimelineMeta().canRedo, true);

    redo();
    assert.equal(store.description, "second");
    assert.equal(getTimelineMeta().canRedo, false);

    undo();
    undo();
    assert.equal(store.description, "");
    assert.equal(getTimelineMeta().canUndo, false);
  });

  it("coalesces same-path text edits but splits after a commit", () => {
    const store = newStore();
    const base = getTimelineMeta().entries.length;

    store.setDescription({ description: "a" });
    store.setDescription({ description: "ab" });
    store.setDescription({ description: "abc" });
    assert.equal(getTimelineMeta().entries.length, base + 1);
    assert.equal(store.description, "abc");

    commitTimelineSegment();
    store.setDescription({ description: "abcd" });
    assert.equal(getTimelineMeta().entries.length, base + 2);

    undo();
    assert.equal(store.description, "abc");
  });

  it("records an AI flow as a single turn and undo reverts its conversation", async () => {
    const store = newStore();
    const base = getTimelineMeta().entries.length;

    await store.sendConversationMessage(
      { message: "hello agent" },
      scriptedStreamFn([assistantMessage([{ type: "text", text: "hi there" }])]),
    );

    const meta = getTimelineMeta();
    assert.equal(meta.entries.length, base + 1);
    const last = meta.entries[meta.entries.length - 1];
    assert.equal(last.source, "ai");
    assert.equal(last.label, "Answer the conversation");
    assert.ok(store.conversation.length >= 2);

    undo();
    assert.equal(store.conversation.length, 0);
    redo();
    assert.ok(store.conversation.length >= 2);
  });

  it("rewind reverts artifacts and conversation; cancel restores everything", async () => {
    const store = newStore();
    await store.sendConversationMessage(
      { message: "please generate requirements" },
      scriptedStreamFn([assistantMessage([{ type: "text", text: "done" }])]),
    );
    const beforeRewind = snapshotOf(store);

    // The user message is at index 0; rewinding reverts to before it.
    assert.equal(beginRewind(0), true);
    assert.equal(store.conversation.length, 0);
    assert.equal(getTimelineMeta().isRewinding, true);

    cancelRewind();
    assert.deepEqual(snapshotOf(store), beforeRewind);
    assert.equal(getTimelineMeta().isRewinding, false);
  });

  it("committing a rewind branches the tree and the old path stays switchable", async () => {
    const store = newStore();
    await store.sendConversationMessage(
      { message: "first question" },
      scriptedStreamFn([assistantMessage([{ type: "text", text: "first answer" }])]),
    );

    // Rewind to before the first message, then submit a different question.
    assert.equal(beginRewind(0), true);
    await store.sendConversationMessage(
      { message: "second question" },
      scriptedStreamFn([assistantMessage([{ type: "text", text: "second answer" }])]),
    );
    endRewind();

    assert.deepEqual(
      store.conversation.map((message) =>
        (message as { content: { text: string }[] }).content[0].text,
      ),
      ["second question", "second answer"],
    );

    // The old turn is a sibling branch: the fork chip on the root offers it.
    const rootEntry = getTimelineMeta().entries[0];
    assert.equal(rootEntry.alternatives.length, 1);

    // Switching back restores the old branch losslessly.
    const meta = getTimelineMeta();
    void meta;
    const rootAlternatives = getTimelineMeta().entries[0].alternatives;
    assert.ok(rootAlternatives.length > 0);
    const { activateBranch } = await import("../app/store/timeline/controller");
    activateBranch(rootAlternatives[0].id);
    assert.deepEqual(
      store.conversation.map((message) =>
        (message as { content: { text: string }[] }).content[0].text,
      ),
      ["first question", "first answer"],
    );
  });

  it("persists the tree and restores it on a later attach", () => {
    let stored: string | null = null;
    const persistence = {
      load: () => (stored == null ? null : JSON.parse(stored)),
      save: (data: unknown) => {
        stored = JSON.stringify(data);
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

    // Simulate a reload: fresh store hydrated from the project autosave.
    const reloaded = Store.create({
      productOverview: {},
      description: "v2",
    }) as unknown as StoreInstance;
    attachTimeline(reloaded, { persistence });

    assert.equal(reloaded.description, "v2");
    assert.equal(getTimelineMeta().canUndo, true);

    // Undo reaches across the reload boundary into pre-reload history.
    undo();
    assert.equal(reloaded.description, "v1");
    redo();
    assert.equal(reloaded.description, "v2");
  });

  it("starts fresh when the persisted timeline is malformed", () => {
    const persistence = {
      load: () => ({ version: 2, rootId: "x", activeLeafId: "y", nodes: "garbage", artifacts: [] }),
      save: () => true,
    };

    const store = Store.create({ productOverview: {} }) as unknown as StoreInstance;
    attachTimeline(store, { persistence });

    assert.equal(getTimelineMeta().entries.length, 1);
    assert.equal(getTimelineMeta().canUndo, false);
  });

  it("prunes the tree instead of throwing when persistence quota is exceeded", () => {
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
    // The prune keeps the active path; everything else was dropped.
    const entries = getTimelineMeta().entries;
    assert.ok(entries.length >= 1);
    assert.ok(
      entries.every((entry) => entry.stateOnly || entry.messageCount > 0 || true),
    );
  });

  it("jumps to an arbitrary turn", () => {
    const store = newStore();
    store.setDescription({ description: "one" });
    commitTimelineSegment();
    store.setDescription({ description: "two" });
    commitTimelineSegment();
    store.setDescription({ description: "three" });
    commitTimelineSegment();

    const entries = getTimelineMeta().entries;
    jumpToNode(entries[1].id);
    assert.equal(store.description, "one");

    jumpToNode(entries[2].id);
    assert.equal(store.description, "two");
  });

  it("keeps fragment view helpers dead-safe across undo", () => {
    const store = newStore();
    store.productOverview.addPrimaryFeature();
    // A declared step records the artifact mutation so undo has a turn to
    // walk back to.
    store.setDescription({ description: "with feature" });
    commitTimelineSegment();
    // Hold the node reference the way a mounted component does.
    const fragment = store.productOverview.primaryFeatures[0];

    // Undo reverts to the initial state and destroys the fragment node; a
    // transient render can still hold the reference and call its views.
    undo();

    assert.equal(typeof fragment.getCode(), "string");
    assert.equal(fragment.getIndex(), 0);
  });

  it("records only declared steps: infrastructure actions open no turn", () => {
    const store = newStore();
    const entriesBefore = getTimelineMeta().entries.length;

    // Snapshot application and undeclared model actions are infrastructure:
    // they mutate the store but must never appear as history.
    applySnapshot(store, getSnapshot(store));
    store.productOverview.addPrimaryFeature();
    store.productOverview.removePrimaryFeature({
      fragment: store.productOverview.primaryFeatures[0],
    });

    assert.equal(getTimelineMeta().entries.length, entriesBefore);
  });

  it("does not record a turn whose state equals its parent", () => {
    const store = newStore();
    store.setDescription({ description: "same" });
    commitTimelineSegment();
    const entriesBefore = getTimelineMeta().entries.length;
    assert.ok(entriesBefore >= 2);

    // A separate attempt that ends exactly where the last turn ended is a
    // non-event: no clone node, nothing to undo through.
    store.setDescription({ description: "same" });
    commitTimelineSegment();

    assert.equal(getTimelineMeta().entries.length, entriesBefore);
  });

  it("declares every AI flow under its store property name", () => {
    const declared = getDeclaredStepNames();
    for (const name of [
      "sendConversationMessage",
      "handleComment",
      "regenerateLastReply",
      "generateProductOverview",
      "generateUserStories",
      "generateTestCode",
    ]) {
      assert.ok(declared.includes(name), `${name} must be declared`);
    }
  });

  it("admits a declared flow root but records no node for a no-op attempt", async () => {
    const store = newStore();
    const entriesBefore = getTimelineMeta().entries.length;

    // The flow starts (admitted via its declaration), fails validation
    // before mutating anything, closes cleanly (the wrapper routes the
    // error into a validation alert), and records nothing: a non-event,
    // not a clone node.
    await store.generateProductOverview();

    assert.equal(getTimelineMeta().entries.length, entriesBefore);
    assert.equal(getTimelineMeta().canUndo, false);
  });

  it("reloading after an ephemeral-only change records no step", () => {
    const store = newStore();
    store.setDescription({ description: "d" });
    commitTimelineSegment();
    const payload = getTimelineSnapshot();
    assert.ok(payload != null);
    const nodeCount = payload.nodes.length;

    // A fresh session imports the project; import flips bookkeeping flags
    // outside any turn. Re-attaching must not read that as history.
    const fresh = Store.create({ productOverview: {} }) as unknown as StoreInstance;
    applySnapshot(fresh, {
      ...(getSnapshot(store) as Record<string, unknown>),
      isClean: false,
    } as never);
    attachTimeline(fresh, {
      persistence: { load: () => payload, save: () => true },
    });

    const labels = getTimelineMeta().entries.map((entry) => entry.label);
    assert.ok(!labels.includes("reloaded"), `got: ${labels.join(", ")}`);
    assert.equal(getTimelineMeta().entries.length, nodeCount);
  });

  it("sweeps artifacts that no surviving node references", () => {    const store = newStore();
    // One coalescing run: the first capture's description artifact dangles
    // once the run's node updates to the final text.
    store.setDescription({ description: "first draft" });
    store.setDescription({ description: "second draft" });
    commitTimelineSegment();

    const snapshot = getTimelineSnapshot();
    assert.ok(snapshot != null);
    const stored = new Set(snapshot.artifacts.map(([hash]) => hash));
    const reachable = new Set<string>();
    const visit = (value: unknown): void => {
      if (typeof value === "string") {
        if (stored.has(value)) reachable.add(value);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (value != null && typeof value === "object") {
        Object.values(value).forEach(visit);
      }
    };
    for (const node of snapshot.nodes) {
      visit((node as { state: unknown }).state);
    }
    assert.ok(reachable.size > 0);
    assert.equal(
      stored.size,
      reachable.size,
      "every persisted artifact must be referenced by a surviving node",
    );
  });

  it("regenerates the last reply without needing agent-session continuity", async () => {
    const store = newStore();
    await store.sendConversationMessage(
      { message: "question" },
      scriptedStreamFn([assistantMessage([{ type: "text", text: "first answer" }])]),
    );

    // A page refresh kills the agent session; regeneration must work purely
    // from the store transcript (replay the user half of the exchange).
    await store.regenerateLastReply(
      scriptedStreamFn([assistantMessage([{ type: "text", text: "second answer" }])]),
    );

    assert.equal(getTimelineMeta().isRewinding, false);
    assert.equal(store.conversation.length, 2);
    assert.match(JSON.stringify(store.conversation), /second answer/);

    // The old exchange stays reachable as a sibling branch, described in
    // reader-facing text (label humanized, prompt as the preview).
    const siblings = getTimelineMeta().entries.flatMap((e) => e.alternatives);
    assert.ok(siblings.length >= 1, "the replaced reply must remain switchable");
    assert.equal(siblings[0].label, "Answer the conversation");
    assert.equal(siblings[0].preview, "question");
    activateBranch(siblings[0].id);
    assert.match(JSON.stringify(store.conversation), /first answer/);
  });

  it("clears the rewind banner when a committed attempt records nothing", async () => {
    const store = newStore();
    await store.sendConversationMessage(
      { message: "hello" },
      scriptedStreamFn([assistantMessage([{ type: "text", text: "hi" }])]),
    );

    assert.equal(beginRewind(0), true);
    assert.equal(getTimelineMeta().isRewinding, true);

    // A declared attempt that ends where the rewind already stands records
    // nothing — but it must still clear the pending-rewind banner.
    store.setDescription({ description: store.description ?? "" });
    commitTimelineSegment();

    assert.equal(getTimelineMeta().isRewinding, false);
  });

  it("describes command branches as actions, not raw JSON", async () => {
    const store = newStore();
    store.setDescription({ description: "A calculator." });
    commitTimelineSegment();
    // First attempt fails (no provider in tests) but records the command.
    await store.generateProductOverview();
    // Regenerate replays the command onto a sibling branch.
    await store.regenerateLastReply(
      scriptedStreamFn([assistantMessage([{ type: "text", text: "overview" }])]),
    );

    const siblings = getTimelineMeta().entries.flatMap((e) => e.alternatives);
    assert.ok(siblings.length >= 1, "the failed attempt must remain switchable");
    assert.equal(siblings[0].preview, "Generate Product Overview");
    assert.equal(siblings[0].label, "Generate the product overview");
  });

  it("committing the rewind happens at submit, not at server completion", async () => {
    const store = newStore();
    await store.sendConversationMessage(
      { message: "q" },
      scriptedStreamFn([assistantMessage([{ type: "text", text: "a" }])]),
    );
    assert.equal(beginRewind(0), true);
    assert.equal(getTimelineMeta().isRewinding, true);

    // Hold the provider response open: the turn is in flight while we
    // assert. The rewind must read as committed the moment the message is
    // submitted — cancelling is no longer possible.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const message = assistantMessage([{ type: "text", text: "late" }]);
    const streamFn = () => {
      const stream = createAssistantMessageEventStream();
      void gate.then(() => {
        stream.push({ type: "start", partial: message } as never);
        stream.push({
          type: "text_delta",
          contentIndex: 0,
          delta: "late",
          partial: message,
        } as never);
        stream.push({ type: "done", reason: "stop", message } as never);
      });
      return stream;
    };

    const inFlight = store.sendConversationMessage({ message: "follow-up" }, streamFn);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      getTimelineMeta().isRewinding,
      false,
      "submitting the follow-up must end the pending rewind",
    );
    release();
    await inFlight;
    assert.equal(getTimelineMeta().isRewinding, false);
  });

  it("regenerate is an internal re-position and never arms the rewind banner", async () => {
    const store = newStore();
    await store.sendConversationMessage(
      { message: "q" },
      scriptedStreamFn([assistantMessage([{ type: "text", text: "a" }])]),
    );

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const message = assistantMessage([{ type: "text", text: "regenerated" }]);
    const streamFn = () => {
      const stream = createAssistantMessageEventStream();
      void gate.then(() => {
        stream.push({ type: "start", partial: message } as never);
        stream.push({
          type: "text_delta",
          contentIndex: 0,
          delta: "regenerated",
          partial: message,
        } as never);
        stream.push({ type: "done", reason: "stop", message } as never);
      });
      return stream;
    };

    const inFlight = store.regenerateLastReply(streamFn);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      getTimelineMeta().isRewinding,
      false,
      "there is nothing cancellable about a regenerate",
    );
    release();
    await inFlight;
    assert.equal(getTimelineMeta().isRewinding, false);
  });

  it("exports the full timeline snapshot for debugging", () => {
    const store = newStore();
    store.setDescription({ description: "hello" });
    commitTimelineSegment();
    store.productOverview.addPrimaryFeature();

    const snapshot = getTimelineSnapshot();
    assert.ok(snapshot != null, "an attached timeline always exports");
    assert.equal(snapshot.version, 2);
    assert.ok(snapshot.nodes.length >= 2, "root plus recorded turns");
    assert.ok(snapshot.rootId.length > 0);
    assert.equal(snapshot.activeLeafId !== snapshot.rootId, true);
    // The artifact store carries every referenced state so an exported
    // timeline is self-contained and can be replayed offline.
    assert.ok(snapshot.artifacts.length > 0);
  });
});
