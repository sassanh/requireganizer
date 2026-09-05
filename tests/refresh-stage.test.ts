import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRefreshComment } from "../app/store/actions/ai-actions/refresh-stage";
import {
  OVERVIEW_NAME_QUALITY_ID,
  OVERVIEW_PURPOSE_QUALITY_ID,
  Status,
  StructuralFragment,
  WorkflowStage,
  refreshGuidance,
} from "../app/store/constants";
import { Store } from "../app/store/store";
import type { FlatStore } from "../app/store/store";

function storeWithStaleStories(): FlatStore {
  const store = Store.create({
    productOverview: {
      name: "Plant Pal",
      purpose: "Help people keep houseplants alive.",
      primaryFeatures: [{ id: "feat-1", content: "Track watering" }],
      targetUsers: [{ id: "user-1", content: "Busy plant owners" }],
    },
  }) as unknown as FlatStore;
  store.approve(OVERVIEW_NAME_QUALITY_ID);
  store.approve(OVERVIEW_PURPOSE_QUALITY_ID);
  store.approve("feat-1");
  store.approve("user-1");
  store.setUserStories({
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
  });
  store.approve("story-1");
  store.markStageGenerated(WorkflowStage.UserStories);
  // The rename unapproves the overview itself, so review and approve it
  // first: only then is refreshing the stale stories the next action.
  store.setName({ name: "Plant Pal Pro" });
  store.approve(OVERVIEW_NAME_QUALITY_ID);
  assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Outdated);
  return store;
}

function storeWithDraftStories(): FlatStore {
  const store = Store.create({
    productOverview: {
      name: "Plant Pal",
      purpose: "Help people keep houseplants alive.",
      primaryFeatures: [{ id: "feat-1", content: "Track watering" }],
      targetUsers: [{ id: "user-1", content: "Busy plant owners" }],
    },
  }) as unknown as FlatStore;
  store.setUserStories({
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
  });
  store.markStageGenerated(WorkflowStage.UserStories);
  assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.NeedsApproval);
  return store;
}

describe("stale stage refresh", () => {
  it("names contract suites for targeted revision, everything else for refresh", () => {
    assert.equal(
      refreshGuidance(WorkflowStage.InterfaceContracts),
      "Revise the affected contracts",
    );
    assert.equal(
      refreshGuidance(WorkflowStage.Requirements),
      "Refresh Requirements",
    );
  });

  it("tells the model what changed and how to touch it", () => {
    const comment = buildRefreshComment(WorkflowStage.Requirements, "keep it short");
    assert.ok(comment.includes("Requirements"));
    assert.ok(comment.includes("byte-identical"));
    assert.ok(comment.includes("keep it short"));
  });

  it("works without a user hint", () => {
    const comment = buildRefreshComment(WorkflowStage.Requirements);
    assert.ok(comment.includes("Requirements"));
  });

  it("offers no refresh when nothing is stale", () => {
    const store = Store.create({
      productOverview: {},
    }) as unknown as FlatStore;
    assert.equal(store.canRefreshStep(WorkflowStage.UserStories), false);
    assert.equal(store.stalePrerequisite(WorkflowStage.Requirements), null);
  });

  it("offers refresh for the outdated prerequisite", () => {
    const store = storeWithStaleStories();
    assert.equal(store.canRefreshStep(WorkflowStage.UserStories), true);
    assert.equal(
      store.stalePrerequisite(WorkflowStage.Requirements),
      WorkflowStage.UserStories,
    );
    assert.equal(
      store.cannotGenerateReason(WorkflowStage.Requirements),
      "Outdated User Stories. Refresh User Stories to generate Requirements.",
    );
  });

  it("never offers refresh for contract suites", () => {
    const store = storeWithStaleStories();
    assert.equal(store.canRefreshStep(WorkflowStage.InterfaceContracts), false);
  });

  it("asks for approval, not refresh, when work is unapproved with current inputs", () => {
    const store = storeWithDraftStories();
    assert.equal(store.canRefreshStep(WorkflowStage.UserStories), false);
    assert.equal(store.stalePrerequisite(WorkflowStage.Requirements), null);
    assert.equal(
      store.cannotGenerateReason(WorkflowStage.Requirements),
      "Approve Product Overview to generate Requirements.",
    );
  });

  it("leads with refresh when work is both unapproved and stale", () => {
    const store = storeWithDraftStories();
    store.setName({ name: "Plant Pal Pro" });
    store.approve(OVERVIEW_NAME_QUALITY_ID);
    store.approve(OVERVIEW_PURPOSE_QUALITY_ID);
    store.approve("feat-1");
    store.approve("user-1");
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Outdated);
    assert.equal(store.canRefreshStep(WorkflowStage.UserStories), true);
    assert.equal(
      store.stalePrerequisite(WorkflowStage.Requirements),
      WorkflowStage.UserStories,
    );
    assert.equal(
      store.cannotGenerateReason(WorkflowStage.Requirements),
      "Outdated User Stories. Refresh User Stories to generate Requirements.",
    );
  });
});
