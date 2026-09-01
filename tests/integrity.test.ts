import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildResultTools } from "../app/ai-agent/result-tools";
import {
  OVERVIEW_NAME_QUALITY_ID,
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
import { Store, workflowFingerprint } from "../app/store/store";
import type { FlatStore } from "../app/store/store";

function storeWithOverview(): FlatStore {
  return Store.create({
    productOverview: {
      name: "Plant Pal",
      purpose: "Help people keep houseplants alive.",
      primaryFeatures: [
        { id: "feat-1", content: "Track watering" },
      ],
      targetUsers: [{ id: "user-1", content: "Busy plant owners" }],
    },
  }) as unknown as FlatStore;
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
        name: "Pal",
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

describe("standing approval and coverage on the store", () => {
  it("yellows a filled overview until every item is approved", () => {
    const store = storeWithOverview();
    assert.equal(store.getStepStatus(WorkflowStage.ProductOverview), Status.Outdated);
    store.approve(OVERVIEW_NAME_QUALITY_ID);
    store.approve(OVERVIEW_PURPOSE_QUALITY_ID);
    store.approve("feat-1");
    store.approve("user-1");
    assert.equal(
      store.getStepStatus(WorkflowStage.ProductOverview),
      Status.Completed,
    );
  });

  it("returns an item to draft when its content is rewritten", () => {
    const store = storeWithStories();
    store.approve("story-1");
    assert.equal(store.userStories[0].approval, "approved");
    store.userStories[0].setContent(
      "As a busy plant owner, I want a rewritten outcome, so that plants stay alive.",
    );
    assert.equal(store.userStories[0].approval, "draft");
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Outdated);
  });

  it("returns name and purpose to draft when they are rewritten", () => {
    const store = storeWithOverview();
    store.approve(OVERVIEW_NAME_QUALITY_ID);
    store.approve(OVERVIEW_PURPOSE_QUALITY_ID);
    store.setName({ name: "Garden Pal" });
    assert.equal(store.productOverview.nameApproval, "draft");
    store.setPurpose({ purpose: "Help gardeners too." });
    assert.equal(store.productOverview.purposeApproval, "draft");
  });

  it("does not complete stories that miss a primary feature", () => {
    const store = storeWithOverview();
    store.setUserStories({
      userStories: [
        {
          id: "story-1",
          content: "As an owner, I want a journal, so that I remember care.",
          references: [{ id: "user-1", type: StructuralFragment.TargetUser }],
          priority: Priority.P1,
        },
      ],
    });
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Pending);
    assert.ok(
      store
        .mechanicalIssuesForStage(WorkflowStage.UserStories)
        .some((issue) => issue.itemId === "feat-1"),
    );
  });

  it("does not complete criteria that miss a requirement", () => {
    const store = storeWithStories();
    store.setRequirements({
      requirements: [
        {
          id: "req-1",
          content: "The system must remind the owner on the watering due date.",
          references: [{ id: "story-1", type: StructuralFragment.UserStory }],
          priority: Priority.P1,
        },
      ],
    });
    store.setAcceptanceCriteria({
      acceptanceCriteria: [
        {
          id: "ac-1",
          content: "Given a due date, when it arrives, the owner is notified.",
          references: [{ id: "story-1", type: StructuralFragment.UserStory }],
          priority: Priority.P1,
        },
      ],
    });
    assert.equal(
      store.getStepStatus(WorkflowStage.AcceptanceCriteria),
      Status.Pending,
    );
  });

  it("does not yellow a downstream stage when only approval changes", () => {
    const store = storeWithStories();
    store.setRequirements({
      requirements: [
        {
          id: "req-1",
          content: "The system must remind the owner on the watering due date.",
          references: [{ id: "story-1", type: StructuralFragment.UserStory }],
          priority: Priority.P1,
        },
      ],
    });
    store.approve("req-1");
    store.markStageGenerated(WorkflowStage.Requirements);
    assert.equal(store.getStepStatus(WorkflowStage.Requirements), Status.Completed);
    const before = workflowFingerprint(store, WorkflowStage.Requirements);
    store.approve("story-1");
    assert.equal(
      workflowFingerprint(store, WorkflowStage.Requirements),
      before,
    );
    assert.equal(store.getStepStatus(WorkflowStage.Requirements), Status.Completed);
  });

  it("yellows a stage when upstream content changes", () => {
    const store = storeWithStories();
    store.approve("story-1");
    store.markStageGenerated(WorkflowStage.UserStories);
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Completed);
    store.setName({ name: "Garden Pal" });
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Outdated);
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
      name: "Plant Pal",
      purpose: "Help people keep houseplants alive.",
      primaryFeatures: ["Track watering schedules"],
      targetUsers: ["Busy plant owners"],
    } as never);
    assert.equal(
      store.getStepStatus(WorkflowStage.ProductOverview),
      Status.Outdated,
    );
    assert.equal(store.productOverview.nameApproval, "draft");
    assert.equal(store.stageIsApproved(WorkflowStage.ProductOverview), false);
    assert.equal(store.canGenerateStep(WorkflowStage.UserStories), false);
  });
});
