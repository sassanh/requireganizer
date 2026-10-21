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
      name: "Plant Pal",
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
    name: "Plant Pal",
    purpose: "Help people keep houseplants alive.",
    primaryFeatures: [{ id: "feat-1", content: "Track watering and feeding" }],
    targetUsers: ["user-1"],
  });
  store.applyPendingImpactChange();
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

  it("returns a changed input's content before and after", async () => {
    const store = storeWithChangedFeature();
    const changes = await readTool(store, "get_input_changes", {
      stage: WorkflowStage.UserStories,
    }) as { id: string; code: string; before: { content: string }; after: { content: string } }[];
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.id, "feat-1");
    assert.equal(changes[0]!.code, "FEA-1");
    assert.equal(changes[0]!.before.content, "Track watering");
    assert.equal(changes[0]!.after.content, "Track watering and feeding");
  });

  it("rejects an unknown stage", async () => {
    const store = storeWithChangedFeature();
    const tool = buildReadTools(store).find(({ name }) => name === "get_stage_artifacts")!;
    await assert.rejects(tool.execute("call-1", { stage: "nowhere" } as never), /Unknown stage nowhere/);
  });
});
