import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import {
  OVERVIEW_NAME_QUALITY_ID,
  OVERVIEW_PURPOSE_QUALITY_ID,
  Priority,
  Status,
  StructuralFragment,
  WorkflowStage,
} from "../app/store/constants";
import { Store as StoreModel } from "../app/store/store";

type TestStore = ReturnType<typeof StoreModel.create>;

function overviewWithFeatures() {
  return {
    name: "Plant Pal",
    purpose: "Help people keep houseplants alive.",
    primaryFeatures: [{ id: "feat-1", content: "Track watering" }],
    targetUsers: [{ id: "user-1", content: "Busy plant owners" }],
  };
}

function storySnapshots() {
  return {
    userStories: [
      {
        id: "story-1",
        content:
          "As a busy plant owner, I want watering reminders, so that plants stay alive.",
        references: [
          { id: "feat-1", type: StructuralFragment.PrimaryFeature },
          { id: "user-1", type: StructuralFragment.TargetUser },
        ],
      },
    ],
  };
}

function requirementSnapshots() {
  return {
    requirements: [
      {
        id: "req-1",
        content: "The app reminds growers to water their plants.",
        references: [{ id: "story-1", type: StructuralFragment.UserStory }],
        priority: Priority.P1,
      },
    ],
  };
}

function approveOverview(store: TestStore) {
  store.approve(OVERVIEW_NAME_QUALITY_ID);
  store.approve(OVERVIEW_PURPOSE_QUALITY_ID);
  store.approve("feat-1");
  store.approve("user-1");
}

function storeWithOverview(): TestStore {
  return StoreModel.create({
    productOverview: overviewWithFeatures(),
  }) as unknown as TestStore;
}

describe("upstream approval gate", () => {
  it("names every earlier stage in the generate blocker, not just the direct input", () => {
    const store = storeWithOverview();
    store.setUserStories(storySnapshots());
    store.markStageGenerated(WorkflowStage.UserStories);
    assert.equal(
      store.cannotGenerateReason(WorkflowStage.Requirements),
      "Approve Product Overview to generate Requirements.",
    );
  });

  it("refuses an approval downstream of unapproved work", () => {
    const store = storeWithOverview();
    store.setUserStories(storySnapshots());
    store.markStageGenerated(WorkflowStage.UserStories);
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.NeedsApproval);
    assert.throws(
      () => store.approve("story-1"),
      /Approve Product Overview before approving User Stories\./,
    );
    assert.equal(store.approvalOf("story-1"), "draft");
  });

  it("approves downstream once upstream is approved", () => {
    const store = storeWithOverview();
    store.setUserStories(storySnapshots());
    store.markStageGenerated(WorkflowStage.UserStories);
    approveOverview(store);
    store.approve("story-1");
    assert.equal(store.approvalOf("story-1"), "approved");
  });

  it("refuses a refresh downstream of unapproved work without reaching the agent", async (t) => {
    const errorSpy = mock.method(console, "error");
    t.after(() => errorSpy.mock.restore());
    const store = storeWithOverview();
    approveOverview(store);
    store.setUserStories(storySnapshots());
    store.setRequirements(requirementSnapshots());
    await store.refreshStage(WorkflowStage.Requirements);
    assert.match(
      store.validationErrors ?? "",
      /Approve User Stories before trying to refresh the stage\./,
    );
    assert.equal(store.validationErrorDetails, null);
    assert.equal(errorSpy.mock.callCount(), 0);
  });

  it("refuses a comment downstream of unapproved work without reaching the agent", async () => {
    const store = storeWithOverview();
    approveOverview(store);
    store.setUserStories(storySnapshots());
    store.setRequirements(requirementSnapshots());
    const fragment = store.requirements[0]!;
    await store.handleComment({ fragment, comment: "Say it shorter." });
    assert.match(
      store.validationErrors ?? "",
      /Approve User Stories before trying to apply the requested change\./,
    );
  });

  it("refuses a generation blocked by an indirect unapproved stage", async () => {
    const store = storeWithOverview();
    approveOverview(store);
    store.setUserStories(storySnapshots());
    store.approve("story-1");
    store.markStageGenerated(WorkflowStage.UserStories);
    store.setRequirements(requirementSnapshots());
    store.markStageGenerated(WorkflowStage.Requirements);
    await store.generateAcceptanceCriteria();
    assert.match(
      store.validationErrors ?? "",
      /Approve Requirements before trying to generate acceptance criteria items\./,
    );
  });

  it("leads with refresh when the blocker is both stale and unapproved", async () => {
    const store = storeWithOverview();
    approveOverview(store);
    store.setUserStories(storySnapshots());
    store.markStageGenerated(WorkflowStage.UserStories);
    store.setName({ name: "Plant Pal Pro" });
    store.approve(OVERVIEW_NAME_QUALITY_ID);
    await store.refreshStage(WorkflowStage.Requirements);
    assert.match(
      store.validationErrors ?? "",
      /Outdated User Stories\. Refresh User Stories before trying to refresh the stage\./,
    );
    assert.equal(store.validationErrorDetails, null);
  });
});
