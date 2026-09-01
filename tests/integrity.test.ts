import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildResultTools } from "../app/ai-agent/result-tools";
import {
  OVERVIEW_NAME_QUALITY_ID,
  OVERVIEW_PURPOSE_QUALITY_ID,
  Priority,
  Quality,
  Status,
  StructuralFragment,
  WorkflowStage,
} from "../app/store/constants";
import {
  aggregateQuality,
  collectMechanicalIssues,
  uncoveredIds,
} from "../app/store/integrity";
import { Store, workflowFingerprint } from "../app/store/store";
import type { FlatStore } from "../app/store/store";

function storeWithOverview(quality: Quality = Quality.Good): FlatStore {
  return Store.create({
    productOverview: {
      name: "Plant Pal",
      purpose: "Help people keep houseplants alive.",
      nameQuality: quality,
      purposeQuality: quality,
      primaryFeatures: [
        { id: "feat-1", content: "Track watering", quality },
      ],
      targetUsers: [{ id: "user-1", content: "Busy plant owners", quality }],
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
        quality: Quality.Good,
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

  it("aggregates quality with bad winning over unchecked", () => {
    assert.equal(aggregateQuality([]), Quality.Unchecked);
    assert.equal(
      aggregateQuality([Quality.Good, Quality.Unchecked]),
      Quality.Unchecked,
    );
    assert.equal(
      aggregateQuality([Quality.Good, Quality.Bad, Quality.Unchecked]),
      Quality.Bad,
    );
    assert.equal(aggregateQuality([Quality.Good, Quality.Good]), Quality.Good);
  });
});

describe("standing quality and coverage on the store", () => {
  it("yellows a filled overview until quality is good", () => {
    const store = storeWithOverview(Quality.Unchecked);
    assert.equal(store.getStepStatus(WorkflowStage.ProductOverview), Status.Outdated);
    store.markStageQuality(WorkflowStage.ProductOverview, Quality.Good);
    assert.equal(
      store.getStepStatus(WorkflowStage.ProductOverview),
      Status.Completed,
    );
  });

  it("unchecks an item when the user edits content", () => {
    const store = storeWithStories();
    assert.equal(store.userStories[0].quality, Quality.Good);
    store.userStories[0].setContent(
      "As a busy plant owner, I want a rewritten outcome, so that plants stay alive.",
    );
    assert.equal(store.userStories[0].quality, Quality.Unchecked);
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Outdated);
  });

  it("unchecks name and purpose on edit", () => {
    const store = storeWithOverview();
    store.setName({ name: "Garden Pal" });
    assert.equal(store.productOverview.nameQuality, Quality.Unchecked);
    store.setPurpose({ purpose: "Help gardeners too." });
    assert.equal(store.productOverview.purposeQuality, Quality.Unchecked);
  });

  it("does not complete stories that miss a primary feature", () => {
    const store = storeWithOverview();
    store.setUserStories({
      userStories: [
        {
          id: "story-1",
          content: "As an owner, I want a journal, so that I remember care.",
          quality: Quality.Good,
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
          quality: Quality.Good,
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
          quality: Quality.Good,
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

  it("does not yellow a downstream stage when only quality changes", () => {
    const store = storeWithStories();
    store.setRequirements({
      requirements: [
        {
          id: "req-1",
          content: "The system must remind the owner on the watering due date.",
          quality: Quality.Good,
          references: [{ id: "story-1", type: StructuralFragment.UserStory }],
          priority: Priority.P1,
        },
      ],
    });
    store.markStageGenerated(WorkflowStage.Requirements);
    assert.equal(store.getStepStatus(WorkflowStage.Requirements), Status.Completed);
    const before = workflowFingerprint(store, WorkflowStage.Requirements);
    store.userStories[0].setQuality(Quality.Bad, ["Not independently valuable."]);
    assert.equal(
      workflowFingerprint(store, WorkflowStage.Requirements),
      before,
    );
    assert.equal(store.getStepStatus(WorkflowStage.Requirements), Status.Completed);
  });

  it("yellows a stage when upstream content changes", () => {
    const store = storeWithStories();
    store.markStageGenerated(WorkflowStage.UserStories);
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Completed);
    store.setName({ name: "Garden Pal" });
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Outdated);
  });
});

describe("quality check and generate apply", () => {
  it("marks generated overview items quality-good", async () => {
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
    assert.equal(store.productOverview.nameQuality, Quality.Good);
    assert.equal(store.productOverview.purposeQuality, Quality.Good);
    assert.ok(
      store.productOverview.primaryFeatures.every(
        (item) => item.quality === Quality.Good,
      ),
    );
    assert.equal(
      store.getStepStatus(WorkflowStage.ProductOverview),
      Status.Completed,
    );
  });

  it("records check verdicts without rewriting", async () => {
    const store = storeWithOverview();
    const name = store.productOverview.name;
    const tools = buildResultTools(store, {
      kind: "check",
      stage: WorkflowStage.ProductOverview,
    });
    const check = tools.find(({ name: toolName }) => toolName === "submit_quality_check");
    assert.ok(check != null);
    assert.equal(
      tools.some(({ name: toolName }) => toolName === "submit_product_overview"),
      false,
    );
    await check.execute!("call-1", {
      items: [
        {
          id: OVERVIEW_NAME_QUALITY_ID,
          quality: "bad",
          issues: ["Name names a library, not the product."],
        },
        { id: OVERVIEW_PURPOSE_QUALITY_ID, quality: "good", issues: [] },
        { id: "feat-1", quality: "good", issues: [] },
        { id: "user-1", quality: "good", issues: [] },
      ],
    } as never);
    assert.equal(store.productOverview.name, name);
    assert.equal(store.productOverview.nameQuality, Quality.Bad);
    assert.equal(store.canFixStep(WorkflowStage.ProductOverview), true);
    assert.equal(store.getStepStatus(WorkflowStage.ProductOverview), Status.Outdated);
  });

  it("leaves rewritten fix items unchecked and does not clear outdated", async () => {
    const store = storeWithStories();
    store.markStageGenerated(WorkflowStage.UserStories);
    store.setName({ name: "Garden Pal" });
    store.userStories[0].setQuality(Quality.Bad, ["Not independently valuable."]);
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Outdated);
    const tools = buildResultTools(store, {
      kind: "fix",
      stage: WorkflowStage.UserStories,
    });
    const submit = tools.find(({ name }) => name === "submit_user_story_list");
    assert.ok(submit != null);
    await submit.execute!("call-1", {
      items: [
        {
          key: "story-1",
          id: "story-1",
          content:
            "As a busy plant owner, I want a watering reminder on the due date, so that plants stay alive.",
          priority: Priority.P1,
          references: [
            { id: "feat-1", type: StructuralFragment.PrimaryFeature },
            { id: "user-1", type: StructuralFragment.TargetUser },
          ],
          dependencies: [],
        },
      ],
    } as never);
    assert.equal(store.userStories[0].quality, Quality.Unchecked);
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Outdated);
  });
});
