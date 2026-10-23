import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { applyArtifactListProposal } from "../app/store/actions/ai-actions/utilities";
import {
  Priority,
  Status,
  StructuralFragment,
  WorkflowStage,
} from "../app/store/constants";
import { Store as StoreModel } from "../app/store/store";

type TestStore = ReturnType<typeof StoreModel.create>;

function storeWithOverview(): TestStore {
  return StoreModel.create({
    productOverview: {
      name: "Plant Pal",
      purpose: "Help people keep houseplants alive.",
      primaryFeatures: [{ id: "feat-1", content: "Track watering" }],
      targetUsers: [{ id: "user-1", content: "Busy plant owners" }],
    },
  }) as unknown as TestStore;
}

function approveStage(store: TestStore, step: WorkflowStage) {
  for (const unit of store.stageUnits(step)) {
    if (store.canApprove(unit.id)) store.approve(unit.id);
  }
}

function generateStories(store: TestStore) {
  applyArtifactListProposal(store as never, {
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
}

function generateRequirements(store: TestStore) {
  applyArtifactListProposal(store as never, {
    entityType: StructuralFragment.Requirement,
    items: [{
      key: "r0",
      id: "req-1",
      content: "The system must remind owners when watering is due.",
      priority: Priority.P1,
      references: [{ id: "story-1", type: StructuralFragment.UserStory }],
      dependencies: [],
    }],
  });
}

describe("frontier gate", () => {
  it("names the frontier in the generate blocker, not just the direct input", () => {
    const store = storeWithOverview();
    assert.equal(
      store.cannotGenerateReason(WorkflowStage.Requirements),
      "Complete Product Overview to generate Requirements.",
    );
  });

  it("refuses an approval after the frontier", () => {
    const store = storeWithOverview();
    approveStage(store, WorkflowStage.ProductOverview);
    generateStories(store);
    approveStage(store, WorkflowStage.UserStories);
    generateRequirements(store);
    // Reopen the overview: User Stories and Requirements fall behind the frontier.
    store.setName({ name: "Plant Pal Pro" });
    assert.equal(store.frontier, WorkflowStage.ProductOverview);
    assert.equal(store.getStepStatus(WorkflowStage.Requirements), Status.Waiting);
    assert.throws(
      () => store.approve("req-1"),
      /Complete Product Overview before approving Requirements\./,
    );
    assert.equal(store.approvalOf("req-1"), "draft");
  });

  it("approves at the frontier", () => {
    const store = storeWithOverview();
    approveStage(store, WorkflowStage.ProductOverview);
    generateStories(store);
    store.approve("story-1");
    assert.equal(store.approvalOf("story-1"), "approved");
  });

  it("refuses a refresh after the frontier without reaching the agent", async (t) => {
    const errorSpy = mock.method(console, "error");
    t.after(() => errorSpy.mock.restore());
    const store = storeWithOverview();
    approveStage(store, WorkflowStage.ProductOverview);
    generateStories(store);
    generateRequirements(store);
    await store.refreshStage(WorkflowStage.Requirements);
    assert.match(
      store.validationErrors ?? "",
      /Complete User Stories before trying to refresh the stage\./,
    );
    assert.equal(store.validationErrorDetails, null);
    assert.equal(errorSpy.mock.callCount(), 0);
  });

  it("refuses a comment after the frontier without reaching the agent", async () => {
    const store = storeWithOverview();
    approveStage(store, WorkflowStage.ProductOverview);
    generateStories(store);
    generateRequirements(store);
    const fragment = store.requirements[0]!;
    await store.handleComment({
      fragment: { id: fragment.id, type: fragment.type },
      comment: "Say it shorter.",
    });
    assert.match(
      store.validationErrors ?? "",
      /Complete User Stories before trying to apply the requested change\./,
    );
  });

  it("refuses a generation while an earlier stage is incomplete", async () => {
    const store = storeWithOverview();
    approveStage(store, WorkflowStage.ProductOverview);
    generateStories(store);
    approveStage(store, WorkflowStage.UserStories);
    generateRequirements(store);
    await store.generateAcceptanceCriteria();
    assert.match(
      store.validationErrors ?? "",
      /Complete Requirements before trying to generate acceptance criteria items\./,
    );
  });
});
