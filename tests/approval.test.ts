import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildResultTools } from "../app/ai-agent/result-tools";
import { fingerprint } from "../app/contract-domain";
import {
  OVERVIEW_NAME_QUALITY_ID,
  OVERVIEW_PURPOSE_QUALITY_ID,
  Status,
  StructuralFragment,
  WorkflowStage,
} from "../app/store/constants";
import { Store, workflowFingerprint } from "../app/store/store";
import type { FlatStore } from "../app/store/store";

const emptyRevisionId = fingerprint([]);

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

function approveOverview(store: FlatStore) {
  store.approve(OVERVIEW_NAME_QUALITY_ID);
  store.approve(OVERVIEW_PURPOSE_QUALITY_ID);
  store.productOverview.primaryFeatures.forEach((item) => store.approve(item.id));
  store.productOverview.targetUsers.forEach((item) => store.approve(item.id));
}

describe("explicit approval", () => {
  it("keeps generated work draft until each item is approved", async () => {
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
    assert.equal(store.productOverview.nameApproval, "draft");
    assert.equal(store.getStepStatus(WorkflowStage.ProductOverview), Status.Outdated);
    assert.equal(store.stageIsApproved(WorkflowStage.ProductOverview), false);
    assert.equal(store.canGenerateStep(WorkflowStage.UserStories), false);
    assert.equal(
      store.cannotGenerateReason(WorkflowStage.UserStories),
      "Approve Product Overview to generate User Stories.",
    );
  });

  it("approves item by item and only then unlocks the next stage", () => {
    const store = storeWithOverview();
    assert.equal(store.canApprove(OVERVIEW_NAME_QUALITY_ID), true);
    store.approve(OVERVIEW_NAME_QUALITY_ID);
    store.approve(OVERVIEW_PURPOSE_QUALITY_ID);
    store.approve("feat-1");
    assert.equal(store.stageIsApproved(WorkflowStage.ProductOverview), false);
    store.approve("user-1");
    assert.equal(store.stageIsApproved(WorkflowStage.ProductOverview), true);
    assert.equal(store.canGenerateStep(WorkflowStage.UserStories), true);
    assert.equal(store.canApprove("feat-1"), false);
  });

  it("returns an approved item to draft when content is rewritten", () => {
    const store = storeWithOverview();
    approveOverview(store);
    assert.equal(store.productOverview.nameApproval, "approved");
    store.setName({ name: "Garden Pal" });
    assert.equal(store.productOverview.nameApproval, "draft");
    assert.equal(store.stageIsApproved(WorkflowStage.ProductOverview), false);
  });

  it("does not change fingerprints when approving", () => {
    const store = storeWithOverview();
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
    const before = workflowFingerprint(store, WorkflowStage.UserStories);
    approveOverview(store);
    assert.equal(workflowFingerprint(store, WorkflowStage.UserStories), before);
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Outdated);
  });

  it("keeps a draft revision draft on import", async () => {
    const store = Store.create({ productOverview: {} }) as unknown as FlatStore & {
      import(value: unknown): void;
    };
    store.import({
      schemaVersion: 3,
      productOverview: {
        name: "Plant Pal",
        purpose: "Help people keep houseplants alive.",
        primaryFeatures: [{ id: "feat-1", content: "Track watering" }],
        targetUsers: [{ id: "user-1", content: "Busy plant owners" }],
      },
      userStories: [],
      requirements: [],
      acceptanceCriteria: [],
      boundaryDesign: {
        id: "boundary",
        revisionId: "boundary-r1",
        revision: 1,
        status: "draft",
        createdAt: "2026-08-13T00:00:00.000Z",
        requirementsRevisionId: emptyRevisionId,
        acceptanceCriteriaRevisionId: emptyRevisionId,
        rootSubjectId: "product",
        subjects: [
          {
            id: "product",
            name: "Plant Pal",
            purpose: "Keep plants alive",
            classification: "external",
            parentSubjectId: null,
            responsibilities: ["Remind"],
            exclusions: [],
            lifecycle: "fresh_per_case",
            requirementIds: [],
            acceptanceCriteriaIds: [],
          },
        ],
        interfaces: [],
        interactions: [],
        verificationObligations: [],
        coverage: [],
      },
      implementationProfile: null,
      contractSuite: null,
      testScenarios: [],
      projectSetup: null,
      scaffoldFiles: [],
      stageInputFingerprints: {},
    });
    assert.equal(store.boundaryDesign?.status, "draft");
    assert.equal(store.stageIsApproved(WorkflowStage.BoundaryDesign), false);
  });
});
