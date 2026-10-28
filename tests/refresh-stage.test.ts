import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRefreshComment } from "../app/store/actions/ai-actions/refresh-stage";
import {
  applyArtifactListProposal,
  applyProductOverviewProposal,
} from "../app/store/actions/ai-actions/utilities";
import {
  Priority,
  Status,
  StructuralFragment,
  WorkflowStage,
  refreshGuidance,
} from "../app/store/constants";
import { Store } from "../app/store/store";
import type { FlatStore } from "../app/store/store";

function approveStage(store: FlatStore, step: WorkflowStage) {
  for (const unit of store.stageUnits(step)) {
    if (store.canApprove(unit.id)) store.approve(unit.id);
  }
}

function storeWithDraftStories(): FlatStore {
  const store = Store.create({
    productOverview: {
      purpose: "Help people keep houseplants alive.",
      primaryFeatures: [{ id: "feat-1", content: "Track watering" }],
      targetUsers: [{ id: "user-1", content: "Busy plant owners" }],
    },
  }) as unknown as FlatStore;
  approveStage(store, WorkflowStage.ProductOverview);
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

/** Approved stories whose feature was rewritten and approved since. */
function storeWithOutdatedStories(): FlatStore {
  const store = storeWithDraftStories();
  approveStage(store, WorkflowStage.UserStories);
  applyProductOverviewProposal(store, {
    purpose: "Help people keep houseplants alive.",
    primaryFeatures: [{ id: "feat-1", content: "Track watering and feeding" }],
    targetUsers: ["user-1"],
  });
  store.applyPendingImpactChange();
  store.approve("feat-1");
  assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Outdated);
  return store;
}

describe("outdated stage refresh", () => {
  it("names contract suites for targeted revision, everything else for refresh", () => {
    assert.equal(
      refreshGuidance(WorkflowStage.InterfaceContracts),
      "Revise the affected contracts",
    );
    assert.equal(refreshGuidance(WorkflowStage.Requirements), "Refresh Requirements");
  });

  it("tells the model what to reconsider and passes the hint", () => {
    const comment = buildRefreshComment(WorkflowStage.Requirements, "keep it short", [], ["REQ-2"]);
    assert.match(comment, /Requirements/);
    assert.match(comment, /Reconsider each outdated item \(REQ-2\)/);
    assert.match(comment, /keep it word for word when the change does not affect it/);
    assert.match(comment, /keep it short$/);
  });

  it("never promises that kept items keep their approval", () => {
    assert.doesNotMatch(buildRefreshComment(WorkflowStage.Requirements), /approv/i);
  });

  it("hands the model the exact upstream change", () => {
    const store = storeWithOutdatedStories();
    const comment = buildRefreshComment(
      WorkflowStage.UserStories,
      undefined,
      store.inputChanges(WorkflowStage.UserStories),
      store.outdatedItemIds(WorkflowStage.UserStories).map((id) => store.getCode(id) ?? id),
    );
    assert.match(comment, /Upstream changes:/);
    assert.match(comment, /Rewrote FEA-01: "Track watering" → "Track watering and feeding"/);
    assert.match(comment, /\(US-01\)/);
  });

  it("offers no refresh when nothing is outdated", () => {
    const store = storeWithDraftStories();
    assert.equal(store.canRefreshStep(WorkflowStage.UserStories), false);
    assert.equal(store.stalePrerequisite(WorkflowStage.Requirements), null);
    assert.equal(
      store.cannotGenerateReason(WorkflowStage.Requirements),
      "Complete User Stories to generate Requirements.",
    );
  });

  it("offers refresh for the outdated frontier", () => {
    const store = storeWithOutdatedStories();
    assert.equal(store.canRefreshStep(WorkflowStage.UserStories), true);
    assert.equal(store.stalePrerequisite(WorkflowStage.Requirements), WorkflowStage.UserStories);
    assert.equal(
      store.cannotGenerateReason(WorkflowStage.Requirements),
      "Outdated User Stories. Refresh User Stories to generate Requirements.",
    );
  });

  it("never offers refresh for contract suites", () => {
    const store = storeWithOutdatedStories();
    assert.equal(store.canRefreshStep(WorkflowStage.InterfaceContracts), false);
  });
});
