import "./support/reviewerModel";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getSnapshot } from "mobx-state-tree";

import { assistantMessage, scriptedStreamFn } from "./support/scriptedStream";
import { agentToolDescriptions, callAgentTool } from "../app/ai-agent/agent-access";
import { applyArtifactListProposal } from "../app/store/actions/ai-actions/utilities";
import { Priority, StructuralFragment, WorkflowStage } from "../app/store/constants";
import { createModuleStore, Store } from "../app/store/store";
import { waitsForPerson } from "../app/store/threads";


const OVERVIEW = {
  purpose: "Help people keep houseplants alive.",
  primaryFeatures: ["Track watering schedules"],
  targetUsers: ["Busy plant owners"],
};

const AGENT = { name: "Claude Code" };
const AGENT_AUTHOR = { kind: "agent" as const, name: AGENT.name };

async function overviewStore(): Promise<Store> {
  const store = Store.create({ productOverview: {} });
  await callAgentTool(store, "submit_product_overview", OVERVIEW, {}, AGENT);
  return store;
}

function targetUserId(store: Store): string {
  return store.productOverview.targetUsers[0]!.id;
}

function toolNames(store: Store): string[] {
  return agentToolDescriptions(store).map(({ name }) => name);
}

describe("change request threads", () => {
  it("keeps one open thread per unit, which waits on the answerer until it replies", async () => {
    const store = await overviewStore();
    const unitId = targetUserId(store);
    const first = store.requestChange(unitId, "Name the kind of owner.");
    assert.equal(store.requestChange(unitId, "Busy people who travel."), first);
    const thread = store.openThreadOf(unitId)!;
    assert.deepEqual(thread.messages.map(({ text }) => text), ["Name the kind of owner.", "Busy people who travel."]);
    assert.equal(waitsForPerson(thread), false);
    assert.equal(store.threadsWaitingForPerson(WorkflowStage.ProductOverview), 0);
  });

  it("is resolved only by the person; a later request opens a new thread", async () => {
    const store = await overviewStore();
    const unitId = targetUserId(store);
    const first = store.requestChange(unitId, "Shorter.");
    store.resolveThread(first);
    assert.equal(store.openThreadOf(unitId), null);
    const second = store.requestChange(unitId, "Shorter still.");
    assert.notEqual(second, first);
    assert.deepEqual(store.threadsOf(unitId).map(({ id }) => id), [first, second]);
  });

  it("takes the answer of whoever the project names as answerer, and nobody else's", async () => {
    const store = await overviewStore();
    const threadId = store.requestChange(targetUserId(store), "Shorter.");
    assert.throws(
      () => store.answerThreads([{ threadId, text: "Done." }], AGENT_AUTHOR),
      /Requireganizer's AI answers change requests in this project/,
    );
    store.setThreadAnswerer("coding-agent");
    assert.throws(
      () => store.answerThreads([{ threadId, text: "Done." }], { kind: "model", model: "writer" }),
      /The coding agent answers change requests/,
    );
    store.answerThreads([{ threadId, text: "Shortened it." }], AGENT_AUTHOR);
    assert.equal(waitsForPerson(store.openThreadOf(targetUserId(store))!), true);
    assert.equal(store.threadsWaitingForPerson(WorkflowStage.ProductOverview), 1);
  });

  it("ends a thread when its unit is gone", async () => {
    const store = await overviewStore();
    const removed = targetUserId(store);
    store.requestChange(removed, "Drop this one.");
    applyArtifactListProposal(store, {
      entityType: StructuralFragment.TargetUser,
      items: [{ key: "k0", content: "Plant collectors", priority: Priority.P1, dependencies: [], references: [] }],
    });
    // A proposed removal stays in the list, with its thread, until it is approved.
    assert.equal(store.openThreads(WorkflowStage.ProductOverview).length, 1);
    store.approve(removed);
    assert.equal(store.reviewUnit(removed), null);
    assert.deepEqual(store.openThreads(WorkflowStage.ProductOverview), []);
  });

  it("keeps threads and the answerer through export and import; a module from before has neither", async () => {
    const store = await overviewStore();
    store.setThreadAnswerer("coding-agent");
    const threadId = store.requestChange(targetUserId(store), "Shorter.");
    const restored = createModuleStore(getSnapshot(store));
    assert.equal(restored.threadAnswerer, "coding-agent");
    assert.equal(restored.openThreadOf(targetUserId(restored))?.id, threadId);

    const { threads: _threads, review, ...older } = getSnapshot(store) as unknown as Record<string, unknown> & {
      review: Record<string, unknown>;
    };
    const { answerer: _answerer, ...olderReview } = review;
    const fromBefore = createModuleStore({ ...older, review: olderReview });
    assert.equal(fromBefore.threadAnswerer, "requireganizer");
    assert.deepEqual(fromBefore.threads, []);

    assert.throws(
      () => createModuleStore({ ...older, review: olderReview, threads: [{ id: "t", unitId: "u", messages: [] }] }),
      /Thread 1 must have at least one message\./,
    );
  });

  it("holds an answer with a change that waits for the person's confirmation", async () => {
    const store = await overviewStore();
    store.setThreadAnswerer("coding-agent");
    const threadId = store.requestChange(targetUserId(store), "Shorter.");
    store.queueImpactChange({
      sourceStep: WorkflowStage.ProductOverview,
      sourceLabel: "Product Overview",
      affectedSteps: [],
      affectedArtifacts: [],
      summary: "Apply the change.",
      candidateSnapshot: getSnapshot(store),
    });
    store.answerThreads([{ threadId, text: "Shortened it." }], AGENT_AUTHOR);
    assert.equal(store.openThreadOf(targetUserId(store))!.messages.length, 1);
    store.applyPendingImpactChange();
    assert.equal(store.openThreadOf(targetUserId(store))!.messages.at(-1)!.text, "Shortened it.");
  });
});

describe("change request threads over MCP", () => {
  it("offers the answering tools only while the coding agent answers", async () => {
    const store = await overviewStore();
    assert.ok(!toolNames(store).includes("reply_to_thread"));
    const submit = () => agentToolDescriptions(store).find(({ name }) => name === "submit_product_overview")!;
    assert.equal((submit().inputSchema.properties as Record<string, unknown>).answers, undefined);
    store.setThreadAnswerer("coding-agent");
    assert.ok(toolNames(store).includes("reply_to_thread"));
    assert.notEqual((submit().inputSchema.properties as Record<string, unknown>).answers, undefined);
  });

  it("lists open threads, and answers one with a submission signed by the agent", async () => {
    const store = await overviewStore();
    store.setThreadAnswerer("coding-agent");
    const threadId = store.requestChange(targetUserId(store), "Say who they are.");
    const state = JSON.parse(await callAgentTool(store, "get_workflow_state", {}, {}, AGENT)) as {
      changeRequestsAnsweredBy: string;
      stages: { stage: string; openThreads: { threadId: string; waitingFor: string; messages: { from: string; text: string }[] }[] }[];
    };
    assert.equal(state.changeRequestsAnsweredBy, "coding-agent");
    const overview = state.stages.find(({ stage }) => stage === WorkflowStage.ProductOverview)!;
    assert.deepEqual(overview.openThreads, [
      { threadId, unitId: targetUserId(store), waitingFor: "coding-agent", messages: [{ from: "person", text: "Say who they are." }] },
    ] as never);

    const text = await callAgentTool(
      store,
      "submit_product_overview",
      { ...OVERVIEW, targetUsers: ["Busy plant owners who travel"], answers: [{ threadId, reply: "Named them." }] },
      {},
      AGENT,
    );
    assert.match(text, /Replied to one thread/);
    const thread = store.threads.find(({ id }) => id === threadId)!;
    assert.deepEqual(thread.messages.at(-1), {
      ...thread.messages.at(-1)!,
      author: AGENT_AUTHOR,
      text: "Named them.",
      withSubmission: true,
    });
  });

  it("refuses answers to a thread of another stage, and replies without changing work", async () => {
    const store = await overviewStore();
    store.setThreadAnswerer("coding-agent");
    const threadId = store.requestChange(targetUserId(store), "Why this one?");
    await assert.rejects(
      callAgentTool(store, "reply_to_thread", { threadId: "missing", text: "Hi." }, {}, AGENT),
      /No open thread missing/,
    );
    assert.equal(
      await callAgentTool(store, "reply_to_thread", { threadId, text: "They need reminders most." }, {}, AGENT),
      "Replied. The thread waits for the person.",
    );
    const thread = store.threads.find(({ id }) => id === threadId)!;
    assert.equal(thread.messages.at(-1)!.withSubmission, undefined);
    assert.equal(store.threadAnswerProblem([{ threadId, text: "x" }], AGENT_AUTHOR, WorkflowStage.UserStories),
      `Thread ${threadId} is about Product Overview; answer it with that stage's submission or with reply_to_thread.`);
  });
});

describe("Requireganizer's AI answering a thread", () => {
  it("revises the unit and replies in the thread", async () => {
    const store = await overviewStore();
    const unitId = targetUserId(store);
    const threadId = store.requestChange(unitId, "Say who they are.");
    const stream = scriptedStreamFn([
      assistantMessage([
        {
          type: "toolCall",
          id: "call-1",
          name: "submit_fragment_revision",
          arguments: { patch: { content: "Busy plant owners who travel" } },
        },
      ]),
      assistantMessage([{ type: "text", text: "Named them as owners who travel." }]),
    ]);
    const outcome = await store.answerThread(WorkflowStage.ProductOverview, threadId, stream);
    assert.deepEqual(outcome, { status: "completed" });
    assert.equal(store.productOverview.targetUsers[0]!.content, "Busy plant owners who travel");
    const reply = store.threads.find(({ id }) => id === threadId)!.messages.at(-1)!;
    assert.equal(reply.author.kind, "model");
    assert.equal(reply.text, "Named them as owners who travel.");
    assert.equal(reply.withSubmission, true);
  });
});
