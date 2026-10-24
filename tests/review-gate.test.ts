import "./support/reviewerModel";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyArtifactListProposal,
  applyFragmentRevisionProposal,
  applyProductOverviewProposal,
} from "../app/store/actions/ai-actions/utilities";
import {
  OVERVIEW_NAME_QUALITY_ID,
  OVERVIEW_PURPOSE_QUALITY_ID,
  Priority,
  Status,
  StructuralFragment,
  WorkflowStage,
} from "../app/store/constants";
import { coverageUnitId, impactUnitId } from "../app/store/review";
import { Store } from "../app/store/store";
import type { FlatStore } from "../app/store/store";

const OVERVIEW = {
  name: "Plant Pal",
  purpose: "Help people keep houseplants alive.",
  primaryFeatures: [{ id: "feat-1", content: "Track watering" }],
  targetUsers: [{ id: "user-1", content: "Busy plant owners" }],
};

const STORY =
  "As a busy plant owner, I want watering reminders, so that plants stay alive.";

function approveStage(store: FlatStore, step: WorkflowStage): void {
  for (const unit of store.stageUnits(step)) {
    if (store.canApprove(unit.id)) store.approve(unit.id);
  }
}

function overviewProposal(changes: Partial<typeof OVERVIEW> = {}) {
  const overview = { ...OVERVIEW, ...changes };
  return {
    name: overview.name,
    purpose: overview.purpose,
    primaryFeatures: overview.primaryFeatures,
    targetUsers: overview.targetUsers,
  };
}

function storyProposal(stories: { id: string; content: string }[]) {
  return {
    entityType: StructuralFragment.UserStory,
    items: stories.map(({ id, content }, index) => ({
      key: `s${index}`,
      id,
      content,
      priority: Priority.P1,
      references: [
        { id: "feat-1", type: StructuralFragment.PrimaryFeature },
        { id: "user-1", type: StructuralFragment.TargetUser },
      ],
      dependencies: [],
    })),
  };
}

/** Overview approved, one story generated and every User Stories unit approved. */
function storeWithCompleteStories(): FlatStore {
  const store = Store.create({ productOverview: OVERVIEW }) as unknown as FlatStore;
  approveStage(store, WorkflowStage.ProductOverview);
  applyArtifactListProposal(store, storyProposal([{ id: "story-1", content: STORY }]));
  approveStage(store, WorkflowStage.UserStories);
  assert.equal(store.frontier, WorkflowStage.Requirements);
  return store;
}

/** Requirements generated and complete, so User Stories is behind the frontier with work after it. */
function storeWithCompleteRequirements(): FlatStore {
  const store = storeWithCompleteStories();
  applyArtifactListProposal(store, {
    entityType: StructuralFragment.Requirement,
    items: [{
      key: "r0",
      id: "requirement-1",
      content: "The system must remind owners when watering is due.",
      priority: Priority.P1,
      references: [{ id: "story-1", type: StructuralFragment.UserStory }],
      dependencies: [],
    }],
  });
  approveStage(store, WorkflowStage.Requirements);
  assert.equal(store.frontier, WorkflowStage.AcceptanceCriteria);
  return store;
}

describe("review gate", () => {
  it("holds an approval only while the checked state matches", () => {
    const store = Store.create({ productOverview: OVERVIEW }) as unknown as FlatStore;
    store.approve(OVERVIEW_NAME_QUALITY_ID);
    store.setName({ name: "Garden Pal" });
    assert.equal(store.approvalOf(OVERVIEW_NAME_QUALITY_ID), "draft");
    assert.equal(store.signedTextOf(OVERVIEW_NAME_QUALITY_ID), "Plant Pal");
    store.setName({ name: "Plant Pal" });
    assert.equal(store.approvalOf(OVERVIEW_NAME_QUALITY_ID), "approved");
  });

  it("advances the frontier one complete stage at a time", () => {
    const store = Store.create({ productOverview: OVERVIEW }) as unknown as FlatStore;
    assert.equal(store.frontier, WorkflowStage.ProductOverview);
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Locked);
    approveStage(store, WorkflowStage.ProductOverview);
    assert.equal(store.frontier, WorkflowStage.UserStories);
    assert.equal(store.getStepStatus(WorkflowStage.ProductOverview), Status.Completed);
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Pending);
  });

  it("keeps a stage incomplete until each parent's coverage is approved", () => {
    const store = Store.create({ productOverview: OVERVIEW }) as unknown as FlatStore;
    approveStage(store, WorkflowStage.ProductOverview);
    applyArtifactListProposal(store, storyProposal([{ id: "story-1", content: STORY }]));
    store.approve("story-1");
    assert.equal(store.frontier, WorkflowStage.UserStories);
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.NeedsApproval);
    store.approve(coverageUnitId("feat-1"));
    assert.equal(store.frontier, WorkflowStage.Requirements);
  });

  it("drops a coverage approval when the covering set changes", () => {
    const store = storeWithCompleteStories();
    applyArtifactListProposal(
      store,
      storyProposal([
        { id: "story-1", content: STORY },
        { id: "story-2", content: "As a busy plant owner, I want a watering log, so that I see gaps." },
      ]),
    );
    assert.equal(store.approvalOf(coverageUnitId("feat-1")), "draft");
    assert.equal(store.approvalOf("story-1"), "approved");
  });

  it("makes later stages read-only until the frontier reaches them", () => {
    const store = storeWithCompleteRequirements();
    applyProductOverviewProposal(
      store,
      overviewProposal({ primaryFeatures: [{ id: "feat-1", content: "Track watering and feeding" }] }),
    );
    store.applyPendingImpactChange();
    assert.equal(store.frontier, WorkflowStage.ProductOverview);
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Waiting);
    assert.throws(() => store.approve(coverageUnitId("feat-1")), /Complete Product Overview/);
    assert.match(
      store.cannotGenerateReason(WorkflowStage.Requirements) ?? "",
      /Complete Product Overview/,
    );
  });

  it("asks before a change moves the frontier back over later work", () => {
    const store = storeWithCompleteRequirements();
    applyArtifactListProposal(store, storyProposal([{ id: "story-1", content: `${STORY} Daily.` }]));
    const pending = store.pendingImpactChange;
    assert.ok(pending != null);
    assert.equal(pending.sourceStep, WorkflowStage.UserStories);
    assert.deepEqual(pending.affectedSteps, [WorkflowStage.Requirements]);
    assert.equal(store.frontier, WorkflowStage.AcceptanceCriteria);
    store.applyPendingImpactChange();
    assert.equal(store.frontier, WorkflowStage.UserStories);
  });

  it("applies a change at the frontier without asking", () => {
    const store = storeWithCompleteStories();
    applyArtifactListProposal(store, storyProposal([{ id: "story-1", content: `${STORY} Daily.` }]));
    assert.equal(store.pendingImpactChange, null);
    assert.equal(store.approvalOf("story-1"), "draft");
  });

  it("returns an item regenerated after its references changed to draft, even word for word", () => {
    const store = storeWithCompleteRequirements();
    applyArtifactListProposal(store, storyProposal([{ id: "story-1", content: `${STORY} Daily.` }]));
    store.applyPendingImpactChange();
    approveStage(store, WorkflowStage.UserStories);
    assert.equal(store.frontier, WorkflowStage.Requirements);
    assert.equal(store.getStepStatus(WorkflowStage.Requirements), Status.Outdated);
    assert.deepEqual(store.outdatedItemIds(WorkflowStage.Requirements), ["requirement-1"]);
    assert.equal(store.canApprove("requirement-1"), false);

    applyArtifactListProposal(store, {
      entityType: StructuralFragment.Requirement,
      items: [{
        key: "r0",
        id: "requirement-1",
        content: "The system must remind owners when watering is due.",
        priority: Priority.P1,
        references: [{ id: "story-1", type: StructuralFragment.UserStory }],
        dependencies: [],
      }],
    });
    assert.deepEqual(store.outdatedItemIds(WorkflowStage.Requirements), []);
    assert.equal(store.approvalOf("requirement-1"), "draft");
    store.approve("requirement-1");
    assert.equal(store.approvalOf("requirement-1"), "approved");
  });

  it("stops a kept change at the items that reference it", () => {
    const store = storeWithCompleteRequirements();
    applyArtifactListProposal(
      store,
      storyProposal([
        { id: "story-1", content: STORY },
        { id: "story-2", content: "As a busy plant owner, I want a watering log, so that I see gaps." },
      ]),
    );
    store.applyPendingImpactChange();
    assert.deepEqual(store.outdatedItemIds(WorkflowStage.Requirements), []);
  });

  it("asks one impact approval for items an upstream change did not reach", () => {
    const store = storeWithCompleteStories();
    applyProductOverviewProposal(
      store,
      overviewProposal({ purpose: "Help people keep every houseplant alive." }),
    );
    store.applyPendingImpactChange();
    store.approve(OVERVIEW_PURPOSE_QUALITY_ID);
    assert.equal(store.frontier, WorkflowStage.UserStories);
    assert.deepEqual(store.outdatedItemIds(WorkflowStage.UserStories), []);
    assert.deepEqual(store.untouchedItemIds(WorkflowStage.UserStories), ["story-1"]);
    assert.ok(store.stageUnitIds(WorkflowStage.UserStories).includes(impactUnitId(WorkflowStage.UserStories)));
    store.approve(impactUnitId(WorkflowStage.UserStories));
    assert.equal(store.frontier, WorkflowStage.Requirements);
    assert.deepEqual(store.changedInputIds(WorkflowStage.UserStories), []);
  });

  it("makes an item sent back from impact review outdated until regenerated", () => {
    const store = storeWithCompleteStories();
    applyProductOverviewProposal(
      store,
      overviewProposal({ purpose: "Help people keep every houseplant alive." }),
    );
    store.applyPendingImpactChange();
    store.approve(OVERVIEW_PURPOSE_QUALITY_ID);
    store.sendBackForRegeneration(["story-1"]);
    assert.deepEqual(store.outdatedItemIds(WorkflowStage.UserStories), ["story-1"]);
    assert.equal(store.reviewUnit(impactUnitId(WorkflowStage.UserStories)), null);
    applyArtifactListProposal(store, storyProposal([{ id: "story-1", content: STORY }]));
    assert.equal(store.approvalOf("story-1"), "draft");
    assert.deepEqual(store.changedInputIds(WorkflowStage.UserStories), []);
  });

  it("restores a rewritten item to its signed version and approval", () => {
    const store = storeWithCompleteStories();
    applyFragmentRevisionProposal(store, {
      entityType: StructuralFragment.UserStory,
      id: "story-1",
      patch: { content: `${STORY} Daily.` },
    });
    assert.equal(store.approvalOf("story-1"), "draft");
    assert.equal(store.signedTextOf("story-1"), STORY);
    assert.equal(store.canRestore("story-1"), true);
    store.restoreSigned("story-1");
    assert.equal(store.approvalOf("story-1"), "approved");
    assert.equal(store.frontier, WorkflowStage.Requirements);
  });

  it("withdraws a proposed removal on restore", () => {
    const store = storeWithCompleteStories();
    applyFragmentRevisionProposal(store, {
      entityType: StructuralFragment.UserStory,
      id: "story-1",
      patch: { remove: true },
    });
    assert.equal(store.approvalOf("story-1"), "draft");
    store.restoreSigned("story-1");
    assert.equal(store.userStories[0]!.pendingRemoval, false);
    assert.equal(store.approvalOf("story-1"), "approved");
  });

  it("keeps a dropped item at its position, so the drop renumbers nothing", () => {
    const store = Store.create({ productOverview: OVERVIEW }) as unknown as FlatStore;
    approveStage(store, WorkflowStage.ProductOverview);
    const stories = ["story-1", "story-2", "story-3"].map((id) => ({ id, content: `${STORY} (${id})` }));
    applyArtifactListProposal(store, storyProposal(stories));
    applyArtifactListProposal(store, storyProposal([stories[0]!, stories[2]!]));
    assert.deepEqual(store.userStories.map(({ id }) => id), ["story-1", "story-2", "story-3"]);
    assert.equal(store.userStories[1]!.pendingRemoval, true);
    assert.equal(store.getCode("story-2"), "US-2");
    assert.equal(store.getCode("story-3"), "US-3");
    // The change note names the dropped item by the code it still shows.
    assert.deepEqual(store.stageListChanges.get(WorkflowStage.UserStories)?.dropped, [
      { id: "story-2", code: "US-2" },
    ]);
  });

  it("keeps a dropped product-overview item at its position", () => {
    const features = ["feat-1", "feat-2", "feat-3"].map((id) => ({ id, content: `Feature ${id}` }));
    const store = Store.create({ productOverview: { ...OVERVIEW, primaryFeatures: features } }) as unknown as FlatStore;
    applyProductOverviewProposal(store, overviewProposal({ primaryFeatures: [features[0]!, features[2]!] }));
    assert.deepEqual(store.productOverview.primaryFeatures.map(({ id }) => id), ["feat-1", "feat-2", "feat-3"]);
    assert.equal(store.productOverview.primaryFeatures[1]!.pendingRemoval, true);
  });

  it("lets a removal be approved even when what the item references changed", () => {
    const store = storeWithCompleteRequirements();
    applyArtifactListProposal(store, storyProposal([{ id: "story-1", content: `${STORY} Daily.` }]));
    store.applyPendingImpactChange();
    approveStage(store, WorkflowStage.UserStories);
    applyArtifactListProposal(store, {
      entityType: StructuralFragment.Requirement,
      items: [{
        key: "r1",
        id: "requirement-2",
        content: "The system must remind owners daily.",
        priority: Priority.P1,
        references: [{ id: "story-1", type: StructuralFragment.UserStory }],
        dependencies: [],
      }],
    });
    assert.equal(store.requirements.find(({ id }) => id === "requirement-1")!.pendingRemoval, true);
    assert.equal(store.canApprove("requirement-1"), true);
    store.approve("requirement-1");
    assert.equal(store.requirements.some(({ id }) => id === "requirement-1"), false);
  });

  it("asks the person to decide before overruling a model rejection", () => {
    const store = Store.create({ productOverview: OVERVIEW }) as unknown as FlatStore;
    approveStage(store, WorkflowStage.ProductOverview);
    applyArtifactListProposal(store, storyProposal([{ id: "story-1", content: STORY }]));
    const checked = store.reviewUnit("story-1")!.checked;
    store.recordVerdicts(
      [{ id: "story-1", checked, verdict: "reject", reason: "The outcome is not testable." }],
      "reviewer-model",
    );
    assert.equal(store.approvalNeedsDecision("story-1"), true);
    assert.throws(() => store.approve("story-1"), /recommends a change/);
    store.approve("story-1", { decided: true });
    const approval = store.reviewUnit("story-1")!.approval!;
    assert.deepEqual(approval.reviewer, { kind: "person" });
    assert.equal(approval.overruled?.verdict, "reject");
  });

  it("drops a verdict given on a state the unit has left", () => {
    const store = Store.create({ productOverview: OVERVIEW }) as unknown as FlatStore;
    store.recordVerdicts(
      [{ id: OVERVIEW_NAME_QUALITY_ID, checked: "stale", verdict: "reject", reason: "No." }],
      "reviewer-model",
    );
    assert.equal(store.currentVerdictOf(OVERVIEW_NAME_QUALITY_ID), null);
  });

  it("reads the reviewer model from configuration", async () => {
    const { reviewerModel } = await import("../app/ai-agent/settings");
    assert.equal(reviewerModel()?.id, "reviewer-model");
  });

  it("approves on an approving verdict only in auto review", () => {
    const store = Store.create({ productOverview: OVERVIEW }) as unknown as FlatStore;
    approveStage(store, WorkflowStage.ProductOverview);
    applyArtifactListProposal(store, storyProposal([{ id: "story-1", content: STORY }]));
    const verdict = () => [{
      id: "story-1",
      checked: store.reviewUnit("story-1")!.checked,
      verdict: "approve" as const,
      reason: "Clear and testable.",
    }];
    store.recordVerdicts(verdict(), "reviewer-model");
    assert.equal(store.approvalOf("story-1"), "draft");
    store.setReviewMode(WorkflowStage.UserStories, "auto");
    assert.equal(store.approvalOf("story-1"), "approved");
    assert.deepEqual(store.reviewUnit("story-1")!.approval!.reviewer, {
      kind: "model",
      model: "reviewer-model",
    });
  });

  it("keeps approvals already given when the mode switches back", () => {
    const store = storeWithCompleteStories();
    store.setReviewMode(WorkflowStage.UserStories, "auto");
    store.setReviewMode(WorkflowStage.UserStories, "manual");
    assert.equal(store.approvalOf("story-1"), "approved");
  });
});
