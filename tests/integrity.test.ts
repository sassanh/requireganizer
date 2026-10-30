import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildResultTools } from "../app/ai-agent/result-tools";
import {
  applyArtifactListProposal,
  applyProductOverviewProposal,
} from "../app/store/actions/ai-actions/utilities";
import {
  OVERVIEW_PURPOSE_QUALITY_ID,
  Priority,
  Status,
  StructuralFragment,
  WorkflowStage,
} from "../app/store/constants";
import {
  collectMechanicalIssues,
  uncoveredIds,
} from "../app/store/integrity";
import { Store } from "../app/store/store";
import type { FlatStore } from "../app/store/store";

function storeWithOverview(): FlatStore {
  return Store.create({
    productOverview: {
      purpose: "Help people keep houseplants alive.",
      primaryFeatures: [
        { id: "feat-1", content: "Track watering" },
      ],
      targetUsers: [{ id: "user-1", content: "Busy plant owners" }],
    },
  }) as unknown as FlatStore;
}

function approveOverview(store: FlatStore) {
  store.approve(OVERVIEW_PURPOSE_QUALITY_ID);
  store.approve("feat-1");
  store.approve("user-1");
}

function storeWithStories(): FlatStore {
  const store = storeWithOverview();
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
        priority: Priority.P1,
      },
    ],
  });
  return store;
}

describe("mechanical coverage", () => {
  it("reports uncovered upstream ids", () => {
    assert.deepEqual(uncoveredIds(["a", "b", "c"], ["a", "c"]), ["b"]);
    assert.deepEqual(uncoveredIds(["a"], ["a", "a"]), []);
  });

  it("flags a feature with no story once stories exist", () => {
    const issues = collectMechanicalIssues({
      productOverview: {
        purpose: "Help.",
        primaryFeatures: [
          {
            id: "feat-1",
            type: StructuralFragment.PrimaryFeature,
            content: "Water",
            references: [],
            dependencies: [],
          },
        ],
        targetUsers: [],
      },
      userStories: [
        {
          id: "story-1",
          type: StructuralFragment.UserStory,
          content: "As a user, I want something else, so that I benefit.",
          references: [{ id: "user-1", type: StructuralFragment.TargetUser }],
          dependencies: [],
        },
      ],
      requirements: [],
      acceptanceCriteria: [],
      boundaryDesign: null,
      testScenarios: [],
    });
    assert.ok(
      issues.some(
        (issue) =>
          issue.stage === WorkflowStage.UserStories &&
          issue.itemId === "feat-1",
      ),
    );
  });

});

function approveStage(store: FlatStore, step: WorkflowStage) {
  for (const unit of store.stageUnits(step)) {
    if (store.canApprove(unit.id)) store.approve(unit.id);
  }
}

function generate(
  store: FlatStore,
  entityType: StructuralFragment,
  items: { id: string; content: string; references: { id: string; type: StructuralFragment }[] }[],
) {
  applyArtifactListProposal(store, {
    entityType,
    items: items.map((item, index) => ({
      key: `k${index}`,
      priority: Priority.P1,
      dependencies: [],
      ...item,
    })),
  });
}

const STORY = {
  id: "story-1",
  content: "As a busy plant owner, I want watering reminders, so that plants stay alive.",
  references: [
    { id: "feat-1", type: StructuralFragment.PrimaryFeature },
    { id: "user-1", type: StructuralFragment.TargetUser },
  ],
};

describe("standing approval and coverage on the store", () => {
  it("marks a filled overview as needing approval until every item is approved", () => {
    const store = storeWithOverview();
    assert.equal(store.getStepStatus(WorkflowStage.ProductOverview), Status.NeedsApproval);
    approveOverview(store);
    assert.equal(store.getStepStatus(WorkflowStage.ProductOverview), Status.Completed);
  });

  it("returns an item to draft when its content is rewritten", () => {
    const store = storeWithOverview();
    approveOverview(store);
    generate(store, StructuralFragment.UserStory, [STORY]);
    approveStage(store, WorkflowStage.UserStories);
    assert.equal(store.approvalOf("story-1"), "approved");
    generate(store, StructuralFragment.UserStory, [{
      ...STORY,
      content: "As a busy plant owner, I want a rewritten outcome, so that plants stay alive.",
    }]);
    assert.equal(store.approvalOf("story-1"), "draft");
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.NeedsApproval);
  });

  it("returns name and purpose to draft when they are rewritten", () => {
    const store = storeWithOverview();
    store.approve(OVERVIEW_PURPOSE_QUALITY_ID);
    store.setPurpose({ purpose: "Garden Pal" });
    assert.equal(store.approvalOf(OVERVIEW_PURPOSE_QUALITY_ID), "draft");
    store.setPurpose({ purpose: "Help gardeners too." });
    assert.equal(store.approvalOf(OVERVIEW_PURPOSE_QUALITY_ID), "draft");
  });

  it("does not complete stories that miss a primary feature", () => {
    const store = storeWithOverview();
    approveOverview(store);
    generate(store, StructuralFragment.UserStory, [{
      id: "story-1",
      content: "As an owner, I want a journal, so that I remember care.",
      references: [{ id: "user-1", type: StructuralFragment.TargetUser }],
    }]);
    approveStage(store, WorkflowStage.UserStories);
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Pending);
    assert.ok(
      store
        .mechanicalIssuesForStage(WorkflowStage.UserStories)
        .some((issue) => issue.itemId === "feat-1"),
    );
  });

  it("does not complete criteria that miss a requirement", () => {
    const store = storeWithOverview();
    approveOverview(store);
    generate(store, StructuralFragment.UserStory, [STORY]);
    approveStage(store, WorkflowStage.UserStories);
    generate(store, StructuralFragment.Requirement, [{
      id: "req-1",
      content: "The system must remind the owner on the watering due date.",
      references: [{ id: "story-1", type: StructuralFragment.UserStory }],
    }]);
    approveStage(store, WorkflowStage.Requirements);
    generate(store, StructuralFragment.AcceptanceCriteria, [{
      id: "ac-1",
      content: "Given a due date, when it arrives, the owner is notified.",
      references: [{ id: "story-1", type: StructuralFragment.UserStory }],
    }]);
    approveStage(store, WorkflowStage.AcceptanceCriteria);
    assert.equal(store.getStepStatus(WorkflowStage.AcceptanceCriteria), Status.Pending);
  });

  it("leaves later stages untouched when only approval changes", () => {
    const store = storeWithOverview();
    approveOverview(store);
    generate(store, StructuralFragment.UserStory, [STORY]);
    const inputs = store.currentInputs(WorkflowStage.Requirements);
    approveStage(store, WorkflowStage.UserStories);
    assert.deepEqual(store.currentInputs(WorkflowStage.Requirements), inputs);
  });

  it("outdates the items that reference changed upstream content", () => {
    const store = storeWithOverview();
    approveOverview(store);
    generate(store, StructuralFragment.UserStory, [STORY]);
    approveStage(store, WorkflowStage.UserStories);
    applyProductOverviewProposal(store, {
      purpose: "Help people keep houseplants alive.",
      primaryFeatures: [{ id: "feat-1", content: "Track watering and light" }],
      targetUsers: ["user-1"],
    });
    store.approve("feat-1");
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Outdated);
    assert.deepEqual(store.outdatedItemIds(WorkflowStage.UserStories), ["story-1"]);
  });
});

describe("generate apply", () => {
  it("keeps generated overview items draft until approved", async () => {
    const store = Store.create({ productOverview: {} }) as unknown as FlatStore;
    const tools = buildResultTools(store, {
      kind: "generate",
      stage: WorkflowStage.ProductOverview,
    });
    const submit = tools.find(({ name }) => name === "submit_product_overview");
    assert.ok(submit != null);
    await submit.execute!("call-1", {
      codesVersion: store.codesVersion,
      purpose: "Help people keep houseplants alive.",
      primaryFeatures: [{ content: "Track watering schedules" }],
      targetUsers: [{ content: "Busy plant owners" }],
    } as never);
    assert.equal(
      store.getStepStatus(WorkflowStage.ProductOverview),
      Status.NeedsApproval,
    );
    assert.equal(store.approvalOf(OVERVIEW_PURPOSE_QUALITY_ID), "draft");
    assert.equal(store.stageIsComplete(WorkflowStage.ProductOverview), false);
    assert.equal(store.canGenerateStep(WorkflowStage.UserStories), false);
  });
});
