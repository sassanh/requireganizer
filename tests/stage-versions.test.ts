import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildReadTools } from "../app/ai-agent/read-tools";
import {
  applyArtifactListProposal,
  applyProductOverviewProposal,
} from "../app/store/actions/ai-actions/utilities";
import {
  Priority,
  StructuralFragment,
  WorkflowStage,
} from "../app/store/constants";
import { Store } from "../app/store/store";
import type { FlatStore } from "../app/store/store";

/** Stories approved, then the feature they reference rewritten and approved. */
function storeWithChangedFeature(): FlatStore {
  const store = Store.create({
    productOverview: {
      purpose: "Help people keep houseplants alive.",
      primaryFeatures: [{ id: "feat-1", content: "Track watering" }],
      targetUsers: [{ id: "user-1", content: "Busy plant owners" }],
    },
  }) as unknown as FlatStore;
  const approveStage = (step: WorkflowStage) => {
    for (const unit of store.stageUnits(step)) {
      if (store.canApprove(unit.id)) store.approve(unit.id);
    }
  };
  approveStage(WorkflowStage.ProductOverview);
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
  approveStage(WorkflowStage.UserStories);
  applyProductOverviewProposal(store, {
    purpose: "Help people keep houseplants alive.",
    primaryFeatures: [{ id: "feat-1", content: "Track watering and feeding" }],
    targetUsers: ["user-1"],
  });
  store.approve("feat-1");
  return store;
}

async function readTool(store: FlatStore, name: string, params: Record<string, unknown> = {}) {
  const tool = buildReadTools(store).find((candidate) => candidate.name === name);
  assert.ok(tool != null);
  const result = await tool.execute("call-1", params as never);
  return JSON.parse(
    (result as { content: { text: string }[] }).content.map((block) => block.text).join(""),
  ) as unknown;
}

describe("workflow reads", () => {
  it("reports the frontier and each stage's outdated items and changed inputs", async () => {
    const store = storeWithChangedFeature();
    const state = await readTool(store, "get_workflow_state") as {
      frontier: string;
      stages: { stage: string; outdatedItemIds: string[]; changedInputIds: string[] }[];
    };
    assert.equal(state.frontier, WorkflowStage.UserStories);
    const stories = state.stages.find(({ stage }) => stage === WorkflowStage.UserStories)!;
    assert.deepEqual(stories.outdatedItemIds, ["story-1"]);
    assert.deepEqual(stories.changedInputIds, ["feat-1"]);
  });

  it("names listed units by code and only counts the units of stages that cannot change yet", async () => {
    const store = storeWithChangedFeature();
    const state = await readTool(store, "get_workflow_state") as { stages: Record<string, unknown>[] };
    const stage = (step: WorkflowStage) => state.stages.find(({ stage: candidate }) => candidate === step)!;
    assert.deepEqual(stage(WorkflowStage.UserStories).labels, {
      "story-1": "US-01",
      "coverage:feat-1": "coverage of FEA-01",
      "feat-1": "FEA-01",
    });
    const requirements = stage(WorkflowStage.Requirements);
    assert.equal(requirements.unapprovedUnitIds, undefined);
    assert.equal(typeof requirements.unapprovedUnitCount, "number");
  });

  it("lists a stage's items with codes, links by code, and what the last signature covered", async () => {
    const store = storeWithChangedFeature();
    const story = {
      code: "US-01",
      id: "story-1",
      status: "outdated",
      priority: "p1",
      content: "As a busy plant owner, I want watering reminders, so that plants stay alive.",
      references: ["FEA-01", "USR-01"],
      dependencies: [],
    };
    assert.deepEqual(await readTool(store, "get_items", { stage: WorkflowStage.UserStories }), {
      stage: WorkflowStage.UserStories,
      codesVersion: store.codesVersion,
      items: [story],
    });
    assert.deepEqual(await readTool(store, "get_items", { stage: WorkflowStage.UserStories, items: ["US-1"] }), {
      stage: WorkflowStage.UserStories,
      codesVersion: store.codesVersion,
      items: [story],
    });
    const tool = buildReadTools(store).find(({ name }) => name === "get_items")!;
    await assert.rejects(
      tool.execute("call-1", { stage: WorkflowStage.UserStories, items: ["US-09"] } as never),
      /User Stories has no item US-09/,
    );

    applyProductOverviewProposal(store, {
      purpose: "Help people keep houseplants alive.",
      primaryFeatures: [{ id: "feat-1", content: "Track watering, feeding and light" }],
      targetUsers: ["user-1"],
    });
    const overview = await readTool(store, "get_items", { stage: WorkflowStage.ProductOverview, items: ["FEA-01"] }) as {
      items: { content: string; sinceSigned?: { content?: string } }[];
    };
    assert.equal(overview.items[0]!.content, "Track watering, feeding and light");
    assert.deepEqual(overview.items[0]!.sinceSigned, { content: "Track watering and feeding" });
  });

  it("reads one thread with the item it is on", async () => {
    const store = storeWithChangedFeature();
    const threadId = store.requestChange("user-1", "Say who they are.");
    const thread = await readTool(store, "get_thread", { threadId }) as Record<string, unknown>;
    assert.equal(thread.unit, "USR-01");
    assert.equal(thread.stage, WorkflowStage.ProductOverview);
    assert.equal(thread.waitingFor, "requireganizer");
    assert.equal(thread.resolved, false);
    assert.deepEqual(thread.messages, [{ from: "person", text: "Say who they are." }]);
    assert.equal((thread.item as { code: string; openThreadId: string }).openThreadId, threadId);
  });

  it("returns a changed input's content before and after", async () => {
    const store = storeWithChangedFeature();
    const changes = await readTool(store, "get_input_changes", {
      stage: WorkflowStage.UserStories,
    }) as { id: string; code: string; before: { content: string }; after: { content: string } }[];
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.id, "feat-1");
    assert.equal(changes[0]!.code, "FEA-01");
    assert.equal(changes[0]!.before.content, "Track watering");
    assert.equal(changes[0]!.after.content, "Track watering and feeding");
  });

  it("rejects an unknown stage", async () => {
    const store = storeWithChangedFeature();
    const tool = buildReadTools(store).find(({ name }) => name === "get_stage_artifacts")!;
    await assert.rejects(tool.execute("call-1", { stage: "nowhere" } as never), /Unknown stage nowhere/);
  });
});
