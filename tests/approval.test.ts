import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildResultTools } from "../app/ai-agent/result-tools";
import { fingerprint } from "../app/contract-domain";
import {
  applyProductOverviewProposal,
  applyTestCaseProposal,
  applyTestScenarioProposal,
} from "../app/store/actions/ai-actions/utilities";
import {
  OVERVIEW_NAME_QUALITY_ID,
  OVERVIEW_PURPOSE_QUALITY_ID,
  Status,
  StructuralFragment,
  WorkflowStage,
} from "../app/store/constants";
import { Store, testDesignFingerprint, workflowFingerprint } from "../app/store/store";
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
    assert.equal(store.productOverview.lastSignedName, "Plant Pal");
    assert.equal(store.stageIsApproved(WorkflowStage.ProductOverview), false);
  });

  it("keeps the last signed text across a second rewrite and clears it on approve", () => {
    const store = storeWithOverview();
    approveOverview(store);
    store.setName({ name: "Garden Pal" });
    store.setName({ name: "Forest Pal" });
    assert.equal(store.productOverview.lastSignedName, "Plant Pal");
    store.approve(OVERVIEW_NAME_QUALITY_ID);
    assert.equal(store.productOverview.lastSignedName, null);
    assert.equal(store.productOverview.nameApproval, "approved");
  });

  it("does not capture last-signed text on a first draft", () => {
    const store = storeWithOverview();
    assert.equal(store.productOverview.nameApproval, "draft");
    store.setName({ name: "Garden Pal" });
    assert.equal(store.productOverview.lastSignedName, null);
  });

  it("does not put last-signed text in the workflow fingerprint", () => {
    const rewritten = storeWithOverview();
    approveOverview(rewritten);
    rewritten.setName({ name: "Garden Pal" });
    const bornDraft = storeWithOverview();
    bornDraft.setName({ name: "Garden Pal" });
    assert.equal(rewritten.productOverview.lastSignedName, "Plant Pal");
    assert.equal(bornDraft.productOverview.lastSignedName, null);
    assert.equal(
      workflowFingerprint(rewritten, WorkflowStage.UserStories),
      workflowFingerprint(bornDraft, WorkflowStage.UserStories),
    );
  });

  it("keeps a signed feature when the overview submit names only its id", () => {
    const store = storeWithOverview();
    approveOverview(store);
    applyProductOverviewProposal(store, {
      name: "Plant Pal",
      purpose: "Help people keep houseplants alive.",
      primaryFeatures: ["feat-1"],
      targetUsers: ["user-1"],
    });
    const feature = store.productOverview.primaryFeatures[0]!;
    assert.equal(feature.approval, "approved");
    assert.equal(feature.lastSignedContent, null);
    assert.equal(store.stageListChangeCaption(WorkflowStage.ProductOverview)?.text, null);
  });

  it("shows a standing rewrite against last-signed feature text", () => {
    const store = storeWithOverview();
    approveOverview(store);
    applyProductOverviewProposal(store, {
      name: "Plant Pal",
      purpose: "Help people keep houseplants alive.",
      primaryFeatures: [{ id: "feat-1", content: "Track watering and feeding" }],
      targetUsers: ["user-1"],
    });
    const feature = store.productOverview.primaryFeatures[0]!;
    assert.equal(feature.approval, "draft");
    assert.equal(feature.lastSignedContent, "Track watering");
    assert.equal(store.stageListChangeCaption(WorkflowStage.ProductOverview)?.grain, "item");
    assert.equal(store.stageListChangeCaption(WorkflowStage.ProductOverview)?.text, null);
  });

  it("keeps a removed feature until that removal is approved", () => {
    const store = storeWithOverview();
    approveOverview(store);
    store.reviseFragment({
      entityType: StructuralFragment.PrimaryFeature,
      id: "feat-1",
      patch: { remove: true },
    });
    const feature = store.productOverview.primaryFeatures[0]!;
    assert.equal(store.productOverview.primaryFeatures.length, 1);
    assert.equal(feature.pendingRemoval, true);
    assert.equal(feature.approval, "draft");
    assert.equal(feature.lastSignedContent, "Track watering");
    assert.equal(store.stageListChangeCaption(WorkflowStage.ProductOverview)?.grain, "item");
    store.approve("feat-1");
    assert.equal(store.productOverview.primaryFeatures.length, 0);
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

describe("identical-content approval", () => {
  function storeWithStory(): FlatStore {
    const store = storeWithOverview();
    approveOverview(store);
    store.setUserStories({
      userStories: [
        {
          id: "story-1",
          content: "As a plant owner, I want watering reminders.",
          references: [{ id: "feat-1", type: StructuralFragment.PrimaryFeature }],
        },
      ],
    });
    store.approve("story-1");
    return store;
  }

  function storeWithContracts(): FlatStore {
    const store = storeWithStory();
    store.setImplementationProfile({
      id: "profile",
      revisionId: "profile-r1",
      revision: 1,
      status: "approved",
      createdAt: "2026-08-13T00:00:00.000Z",
      boundaryRevisionId: "boundary-r1",
    } as never);
    store.setContractSuite({
      id: "suite",
      revisionId: "suite-r1",
      revision: 1,
      status: "approved",
      createdAt: "2026-08-13T00:00:00.000Z",
      interfaceContracts: [{ id: "iface-1", status: "approved" }],
      subjectContracts: [{ id: "subject-1", status: "approved" }],
      verificationContracts: [],
    } as never);
    assert.equal(store.stageIsApproved(WorkflowStage.InterfaceContracts), true);
    return store;
  }

  const binding = { scenarioKind: "behavioral" } as never;

  function scenarioProposal(title: string, id = "scenario-1") {
    return {
      items: [
        {
          key: "a",
          id,
          title,
          description: "Watering overdue path.",
          priority: "p0" as const,
          acceptanceCriteriaIds: [],
          binding,
          dependencies: [],
        },
      ],
    };
  }

  const caseDefinition = {
    kind: "behavioral",
    subjectId: "plant",
    initialFixture: {},
  } as never;

  function caseProposal(description: string, scenarioId: string, id = "case-1") {
    return {
      scenarioId,
      items: [
        {
          key: "c",
          id,
          title: "Overdue reminder",
          description,
          priority: "p0" as const,
          acceptanceCriteriaIds: [],
          definition: caseDefinition,
          dependencies: [],
        },
      ],
    };
  }

  it("re-approves the overview name when an edit lands back on signed text", () => {
    const store = storeWithOverview();
    approveOverview(store);
    store.setName({ name: "Garden Pal" });
    assert.equal(store.productOverview.nameApproval, "draft");
    store.setName({ name: "Plant Pal" });
    assert.equal(store.productOverview.nameApproval, "approved");
    assert.equal(store.productOverview.lastSignedName, null);
  });

  it("re-approves a fragment when a revision lands back on signed text", () => {
    const store = storeWithStory();
    store.reviseFragment({
      entityType: StructuralFragment.UserStory,
      id: "story-1",
      patch: { content: "As a plant owner, I want feeding reminders." },
    });
    const story = store.userStories[0]!;
    assert.equal(story.approval, "draft");
    store.reviseFragment({
      entityType: StructuralFragment.UserStory,
      id: "story-1",
      patch: { content: "As a plant owner, I want watering reminders." },
    });
    assert.equal(story.approval, "approved");
    assert.equal(story.lastSignedContent, null);
  });

  it("keeps overview approval on an identical submit", () => {
    const store = storeWithOverview();
    approveOverview(store);
    applyProductOverviewProposal(store, {
      name: "Plant Pal",
      purpose: "Help people keep houseplants alive.",
      primaryFeatures: ["feat-1"],
      targetUsers: ["user-1"],
    });
    assert.equal(store.productOverview.nameApproval, "approved");
    assert.equal(store.productOverview.purposeApproval, "approved");
    assert.equal(store.stageIsApproved(WorkflowStage.ProductOverview), true);
  });

  it("carries scenario approval and revision across an identical rewrite", () => {
    const store = storeWithContracts();
    applyTestScenarioProposal(store, scenarioProposal("Overdue watering"));
    const scenario = store.testScenarios[0]!;
    store.approve(scenario.id);
    const revisionId = scenario.revisionId;
    const fingerprintBefore = testDesignFingerprint(store);
    applyTestScenarioProposal(store, scenarioProposal("Overdue watering"));
    assert.equal(store.pendingImpactChange, null);
    assert.equal(store.testScenarios[0]!.approval, "approved");
    assert.equal(store.testScenarios[0]!.lastSignedContent, null);
    assert.equal(store.testScenarios[0]!.revisionId, revisionId);
    assert.equal(testDesignFingerprint(store), fingerprintBefore);
  });

  it("drafts a changed scenario but re-approves its revert", () => {
    const store = storeWithContracts();
    applyTestScenarioProposal(store, scenarioProposal("Overdue watering"));
    const scenario = store.testScenarios[0]!;
    store.approve(scenario.id);
    applyTestScenarioProposal(store, scenarioProposal("Missed watering"));
    store.applyPendingImpactChange();
    assert.equal(store.testScenarios[0]!.approval, "draft");
    assert.equal(store.testScenarios[0]!.lastSignedContent, "Overdue watering");
    applyTestScenarioProposal(store, scenarioProposal("Overdue watering"));
    store.applyPendingImpactChange();
    assert.equal(store.testScenarios[0]!.approval, "approved");
    assert.equal(store.testScenarios[0]!.lastSignedContent, null);
  });

  it("carries case approval and generated status across an identical rewrite", () => {
    const store = storeWithContracts();
    applyTestScenarioProposal(store, scenarioProposal("Overdue watering"));
    const scenario = store.testScenarios[0]!;
    store.approve(scenario.id);
    applyTestCaseProposal(store, caseProposal("Reminder shows.", scenario.id));
    const testCase = scenario.testCases[0]!;
    store.approve(testCase.id);
    testCase.markGenerated(testCase.inputFingerprint!);
    assert.equal(testCase.testStatus, "generated");
    applyTestCaseProposal(store, caseProposal("Reminder shows.", scenario.id));
    assert.equal(store.pendingImpactChange, null);
    assert.equal(scenario.testCases[0]!.approval, "approved");
    assert.equal(scenario.testCases[0]!.testStatus, "generated");
  });

  it("marks a changed case out of sync instead of silently keeping it", () => {
    const store = storeWithContracts();
    applyTestScenarioProposal(store, scenarioProposal("Overdue watering"));
    const scenario = store.testScenarios[0]!;
    store.approve(scenario.id);
    applyTestCaseProposal(store, caseProposal("Reminder shows.", scenario.id));
    const testCase = scenario.testCases[0]!;
    store.approve(testCase.id);
    testCase.markGenerated(testCase.inputFingerprint!);
    applyTestCaseProposal(store, caseProposal("Reminder flashes.", scenario.id));
    store.applyPendingImpactChange();
    assert.equal(scenario.testCases[0]!.approval, "draft");
    assert.equal(scenario.testCases[0]!.testStatus, "out-of-sync");
  });
});
