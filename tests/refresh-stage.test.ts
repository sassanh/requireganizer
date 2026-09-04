import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRefreshComment } from "../app/store/actions/ai-actions/refresh-stage";
import { Status, StructuralFragment, WorkflowStage, refreshGuidance } from "../app/store/constants";
import { Store } from "../app/store/store";
import type { FlatStore } from "../app/store/store";

function storeWithStaleStories(): FlatStore {
  const store = Store.create({
    productOverview: {
      name: "Plant Pal",
      purpose: "Help people keep houseplants alive.",
    },
  }) as unknown as FlatStore;
  store.setUserStories({
    userStories: [
      {
        id: "story-1",
        content: "As a grower, I want watering reminders.",
        references: [],
      },
    ],
  });
  store.approve("story-1");
  store.markStageGenerated(WorkflowStage.UserStories);
  store.setName({ name: "Plant Pal Pro" });
  assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Outdated);
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
      "User Stories is outdated. Refresh User Stories to generate Requirements.",
    );
  });

  it("never offers refresh for contract suites", () => {
    const store = storeWithStaleStories();
    assert.equal(store.canRefreshStep(WorkflowStage.InterfaceContracts), false);
  });

  it("asks for approval, not refresh, when work is unapproved with current inputs", () => {
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
          content: "As a busy plant owner, I want watering reminders, so that plants stay alive.",
          references: [
            { id: "feat-1", type: StructuralFragment.PrimaryFeature },
            { id: "user-1", type: StructuralFragment.TargetUser },
          ],
        },
      ],
    });
    store.markStageGenerated(WorkflowStage.UserStories);
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Outdated);
    assert.equal(store.canRefreshStep(WorkflowStage.UserStories), false);
    assert.equal(store.stalePrerequisite(WorkflowStage.Requirements), null);
    assert.equal(
      store.cannotGenerateReason(WorkflowStage.Requirements),
      "Approve User Stories to generate Requirements.",
    );
  });

  it("asks for approval first when work is both unapproved and stale", () => {
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
          content: "As a busy plant owner, I want watering reminders, so that plants stay alive.",
          references: [
            { id: "feat-1", type: StructuralFragment.PrimaryFeature },
            { id: "user-1", type: StructuralFragment.TargetUser },
          ],
        },
      ],
    });
    store.markStageGenerated(WorkflowStage.UserStories);
    store.setName({ name: "Plant Pal Pro" });
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Outdated);
    assert.equal(store.canRefreshStep(WorkflowStage.UserStories), true);
    assert.equal(store.stalePrerequisite(WorkflowStage.Requirements), null);
    assert.equal(
      store.cannotGenerateReason(WorkflowStage.Requirements),
      "Approve User Stories to generate Requirements.",
    );
  });
});
