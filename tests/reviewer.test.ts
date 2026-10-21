import "./support/reviewerModel";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentOptions } from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  ToolCall,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

import { reviewStageUnits } from "../app/ai-agent/reviewer";
import { applyArtifactListProposal } from "../app/store/actions/ai-actions/utilities";
import { Priority, StructuralFragment, WorkflowStage } from "../app/store/constants";
import { coverageUnitId } from "../app/store/review";
import { Store } from "../app/store/store";
import type { FlatStore } from "../app/store/store";

function message(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-responses",
    provider: "opencode",
    model: "reviewer-model",
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: content.some((block) => block.type === "toolCall") ? "toolUse" : "stop",
    timestamp: Date.now(),
  };
}

function verdictCall(verdicts: { id: string; verdict: "approve" | "reject"; reason: string }[]): AssistantMessage {
  const call: ToolCall = { type: "toolCall", id: `call-${Math.random()}`, name: "submit_verdicts", arguments: { verdicts } };
  return message([call]);
}

/** Plays the responses in order and records every request context. */
function scripted(responses: AssistantMessage[]) {
  const contexts: Context[] = [];
  const streamFn: NonNullable<AgentOptions["streamFn"]> = (_model, context) => {
    contexts.push(context);
    const stream = createAssistantMessageEventStream();
    const next = responses[Math.min(contexts.length - 1, responses.length - 1)]!;
    const events: AssistantMessageEvent[] = [
      { type: "start", partial: next },
      ...next.content.map((block, contentIndex) =>
        block.type === "text"
          ? ({ type: "text_delta", contentIndex, delta: block.text, partial: next } as AssistantMessageEvent)
          : ({ type: "toolcall_end", contentIndex, toolCall: block as ToolCall, partial: next } as AssistantMessageEvent),
      ),
      { type: "done", reason: next.stopReason as "stop" | "toolUse", message: next },
    ];
    queueMicrotask(() => events.forEach((event) => stream.push(event)));
    return stream;
  };
  return Object.assign(streamFn, { contexts });
}

/** Overview approved, one draft story: the story and its feature's coverage await review. */
function storeWithDraftStory(): FlatStore {
  const store = Store.create({
    productOverview: {
      name: "Plant Pal",
      purpose: "Help people keep houseplants alive.",
      primaryFeatures: [{ id: "feat-1", content: "Track watering" }],
      targetUsers: [{ id: "user-1", content: "Busy plant owners" }],
    },
  }) as unknown as FlatStore;
  for (const unit of store.stageUnits(WorkflowStage.ProductOverview)) store.approve(unit.id);
  applyArtifactListProposal(store, {
    entityType: StructuralFragment.UserStory,
    items: [{
      key: "s0",
      id: "story-1",
      content: "As a busy plant owner, I want watering reminders, so that plants stay alive.",
      priority: Priority.P1,
      references: [
        { id: "feat-1", type: StructuralFragment.PrimaryFeature },
        { id: "user-1", type: StructuralFragment.TargetUser },
      ],
      dependencies: [],
    }],
  });
  return store;
}

const BOTH_APPROVED = [
  { id: "story-1", verdict: "approve" as const, reason: "Clear user, outcome, and value." },
  { id: coverageUnitId("feat-1"), verdict: "approve" as const, reason: "The story covers watering tracking." },
];

describe("reviewer model", () => {
  it("reviews only units without a current verdict that can be decided", () => {
    const store = storeWithDraftStory();
    assert.deepEqual(
      store.unitsAwaitingReview(WorkflowStage.UserStories).map(({ id }) => id),
      ["story-1", coverageUnitId("feat-1")],
    );
    assert.deepEqual(store.unitsAwaitingReview(WorkflowStage.Requirements), []);
  });

  it("records verdicts without approving in manual review", async () => {
    const store = storeWithDraftStory();
    const streamFn = scripted([verdictCall(BOTH_APPROVED), message([{ type: "text", text: "Done." }])]);
    await reviewStageUnits(store, WorkflowStage.UserStories, streamFn);
    assert.equal(store.currentVerdictOf("story-1")?.verdict, "approve");
    assert.equal(store.currentVerdictOf("story-1")?.model, "reviewer-model");
    assert.equal(store.approvalOf("story-1"), "draft");
    assert.deepEqual(store.unitsAwaitingReview(WorkflowStage.UserStories), []);
  });

  it("approves on approving verdicts in auto review", async () => {
    const store = storeWithDraftStory();
    store.setReviewMode(WorkflowStage.UserStories, "auto");
    const streamFn = scripted([verdictCall(BOTH_APPROVED), message([{ type: "text", text: "Done." }])]);
    await reviewStageUnits(store, WorkflowStage.UserStories, streamFn);
    assert.equal(store.approvalOf("story-1"), "approved");
    assert.equal(store.frontier, WorkflowStage.Requirements);
  });

  it("returns an incomplete submission to the reviewer to complete", async () => {
    const store = storeWithDraftStory();
    const streamFn = scripted([
      verdictCall([BOTH_APPROVED[0]!]),
      verdictCall(BOTH_APPROVED),
      message([{ type: "text", text: "Done." }]),
    ]);
    await reviewStageUnits(store, WorkflowStage.UserStories, streamFn);
    assert.equal(streamFn.contexts.length, 3);
    assert.equal(store.currentVerdictOf(coverageUnitId("feat-1"))?.verdict, "approve");
  });

  it("reviews in a fresh context with the contract and no writer tools", async () => {
    const store = storeWithDraftStory();
    const streamFn = scripted([verdictCall(BOTH_APPROVED), message([{ type: "text", text: "Done." }])]);
    await reviewStageUnits(store, WorkflowStage.UserStories, streamFn);
    const first = streamFn.contexts[0]!;
    assert.equal(first.messages.length, 1);
    const tools = (first.tools ?? []).map(({ name }) => name);
    assert.ok(tools.includes("submit_verdicts"));
    assert.equal(tools.some((name) => name.startsWith("submit_") && name !== "submit_verdicts"), false);
    assert.match(JSON.stringify(first.messages[0]), /independently valuable user outcomes/);
  });

  it("fails clearly when the reviewer submits nothing", async () => {
    const store = storeWithDraftStory();
    const streamFn = scripted([message([{ type: "text", text: "Looks fine." }])]);
    await assert.rejects(
      reviewStageUnits(store, WorkflowStage.UserStories, streamFn),
      /returned no verdicts/,
    );
    assert.equal(store.currentVerdictOf("story-1"), null);
  });
});
