import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildResultTools } from "../app/ai-agent/result-tools";
import {
  applyArtifactListProposal,
  applyFragmentRevisionProposal,
  applyProductOverviewProposal,
  applyTestCaseProposal,
  applyTestScenarioProposal,
} from "../app/store/actions/ai-actions/utilities";
import {
  OVERVIEW_PURPOSE_QUALITY_ID,
  Priority,
  Status,
  StructuralFragment,
  WorkflowStage,
} from "../app/store/constants";
import { itemSetRevision } from "../app/store/review";
import { Store } from "../app/store/store";
import type { FlatStore } from "../app/store/store";

const NOW = "2026-08-13T00:00:00.000Z";

const OVERVIEW = {
  purpose: "Help people keep houseplants alive.",
  primaryFeatures: [{ id: "feat-1", content: "Track watering" }],
  targetUsers: [{ id: "user-1", content: "Busy plant owners" }],
};

function storeWithOverview(): FlatStore {
  return Store.create({ productOverview: OVERVIEW }) as unknown as FlatStore;
}

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
      purpose: "Help people keep houseplants alive.",
      primaryFeatures: ["Track watering schedules"],
      targetUsers: ["Busy plant owners"],
    } as never);
    assert.equal(store.approvalOf(OVERVIEW_PURPOSE_QUALITY_ID), "draft");
    assert.equal(store.getStepStatus(WorkflowStage.ProductOverview), Status.NeedsApproval);
    assert.equal(store.stageIsComplete(WorkflowStage.ProductOverview), false);
    assert.equal(store.canGenerateStep(WorkflowStage.UserStories), false);
    assert.equal(
      store.cannotGenerateReason(WorkflowStage.UserStories),
      "Complete Product Overview to generate User Stories.",
    );
  });

  it("approves item by item and only then advances the frontier", () => {
    const store = storeWithOverview();
    assert.equal(store.canApprove(OVERVIEW_PURPOSE_QUALITY_ID), true);
    store.approve(OVERVIEW_PURPOSE_QUALITY_ID);
    store.approve("feat-1");
    assert.equal(store.frontier, WorkflowStage.ProductOverview);
    store.approve("user-1");
    assert.equal(store.frontier, WorkflowStage.UserStories);
    assert.equal(store.canGenerateStep(WorkflowStage.UserStories), true);
    assert.equal(store.canApprove("feat-1"), false);
  });

  it("shows a rewritten item's signed text until it is approved again", () => {
    const store = storeWithOverview();
    approveStage(store, WorkflowStage.ProductOverview);
    store.setPurpose({ purpose: "Garden Pal" });
    store.setPurpose({ purpose: "Forest Pal" });
    assert.equal(store.approvalOf(OVERVIEW_PURPOSE_QUALITY_ID), "draft");
    assert.equal(store.signedTextOf(OVERVIEW_PURPOSE_QUALITY_ID), "Help people keep houseplants alive.");
    store.approve(OVERVIEW_PURPOSE_QUALITY_ID);
    assert.equal(store.signedTextOf(OVERVIEW_PURPOSE_QUALITY_ID), null);
    assert.equal(store.approvalOf(OVERVIEW_PURPOSE_QUALITY_ID), "approved");
  });

  it("has no signed text on a first draft", () => {
    const store = storeWithOverview();
    store.setPurpose({ purpose: "Garden Pal" });
    assert.equal(store.signedTextOf(OVERVIEW_PURPOSE_QUALITY_ID), null);
  });

  it("keeps approval out of every stage's inputs", () => {
    const approved = storeWithOverview();
    approveStage(approved, WorkflowStage.ProductOverview);
    const draft = storeWithOverview();
    assert.deepEqual(
      approved.currentInputs(WorkflowStage.UserStories),
      draft.currentInputs(WorkflowStage.UserStories),
    );
  });

  it("keeps a signed feature when the overview submit names only its id", () => {
    const store = storeWithOverview();
    approveStage(store, WorkflowStage.ProductOverview);
    applyProductOverviewProposal(store, {
      purpose: "Help people keep houseplants alive.",
      primaryFeatures: ["feat-1"],
      targetUsers: ["user-1"],
    });
    assert.equal(store.approvalOf("feat-1"), "approved");
    assert.equal(store.signedTextOf("feat-1"), null);
    assert.equal(store.stageListChangeCaption(WorkflowStage.ProductOverview)?.text, null);
  });

  it("shows a standing rewrite against the signed feature text", () => {
    const store = storeWithOverview();
    approveStage(store, WorkflowStage.ProductOverview);
    applyProductOverviewProposal(store, {
      purpose: "Help people keep houseplants alive.",
      primaryFeatures: [{ id: "feat-1", content: "Track watering and feeding" }],
      targetUsers: ["user-1"],
    });
    assert.equal(store.approvalOf("feat-1"), "draft");
    assert.equal(store.signedTextOf("feat-1"), "Track watering");
    assert.equal(store.stageListChangeCaption(WorkflowStage.ProductOverview)?.grain, "item");
    assert.equal(store.stageListChangeCaption(WorkflowStage.ProductOverview)?.text, null);
  });

  it("keeps a removed feature until that removal is approved", () => {
    const store = storeWithOverview();
    approveStage(store, WorkflowStage.ProductOverview);
    applyFragmentRevisionProposal(store, {
      entityType: StructuralFragment.PrimaryFeature,
      id: "feat-1",
      patch: { remove: true },
    });
    const feature = store.productOverview.primaryFeatures[0]!;
    assert.equal(store.productOverview.primaryFeatures.length, 1);
    assert.equal(feature.pendingRemoval, true);
    assert.equal(store.approvalOf("feat-1"), "draft");
    assert.equal(store.signedTextOf("feat-1"), "Track watering");
    assert.equal(store.stageListChangeCaption(WorkflowStage.ProductOverview)?.grain, "item");
    store.approve("feat-1");
    assert.equal(store.productOverview.primaryFeatures.length, 0);
  });

  it("keeps an unapproved revision unapproved on import", () => {
    const store = Store.create({ productOverview: {} }) as unknown as FlatStore & {
      import(value: unknown): void;
    };
    store.import({
      schemaVersion: 6,
      productOverview: OVERVIEW,
      userStories: [],
      requirements: [],
      acceptanceCriteria: [],
      boundaryDesign: {
        id: "boundary",
        revisionId: "boundary-r1",
        revision: 1,
        createdAt: NOW,
        requirementsRevisionId: itemSetRevision([]),
        acceptanceCriteriaRevisionId: itemSetRevision([]),
        rootSubjectId: "product",
        subjects: [
          {
            id: "product",
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
    });
    assert.equal(store.approvalOf("boundary"), "draft");
    assert.equal(store.stageIsComplete(WorkflowStage.BoundaryDesign), false);
  });
});

describe("scenario and case approval", () => {
  /** Every stage through Interface Contracts complete, with current revision bindings. */
  function storeWithContracts(): FlatStore {
    const store = storeWithOverview();
    approveStage(store, WorkflowStage.ProductOverview);
    generate(store, StructuralFragment.UserStory, [{
      id: "story-1",
      content: "As a plant owner, I want watering reminders.",
      references: [{ id: "feat-1", type: StructuralFragment.PrimaryFeature }],
    }]);
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
      references: [{ id: "req-1", type: StructuralFragment.Requirement }],
    }]);
    approveStage(store, WorkflowStage.AcceptanceCriteria);
    store.setBoundaryDesign({
      id: "boundary",
      revisionId: "boundary-r1",
      revision: 1,
      createdAt: NOW,
      requirementsRevisionId: itemSetRevision(store.requirements),
      acceptanceCriteriaRevisionId: itemSetRevision(store.acceptanceCriteria),
      rootSubjectId: "product",
      subjects: [],
      interfaces: [],
      interactions: [],
      verificationObligations: [],
      coverage: [
        { acceptanceCriteriaId: "ac-1", targetType: "interaction", targetId: "act-1" },
      ],
    } as never);
    store.approve("boundary");
    store.setImplementationProfile({
      id: "profile",
      revisionId: "profile-r1",
      revision: 1,
      createdAt: NOW,
      boundaryRevisionId: "boundary-r1",
    } as never);
    store.approve("profile");
    store.setContractSuite({
      id: "suite",
      revisionId: "suite-r1",
      revision: 1,
      createdAt: NOW,
      boundaryRevisionId: "boundary-r1",
      profileRevisionId: "profile-r1",
      interfaceContracts: [{
        id: "iface-contract",
        revisionId: "iface-r1",
        revision: 1,
        createdAt: NOW,
        interfaceId: "iface",
        boundaryRevisionId: "boundary-r1",
        profileRevisionId: "profile-r1",
      }],
      subjectContracts: [{
        id: "subject-contract",
        revisionId: "subject-r1",
        revision: 1,
        createdAt: NOW,
        subjectId: "product",
        boundaryRevisionId: "boundary-r1",
        profileRevisionId: "profile-r1",
        interfaceContractRevisionIds: ["iface-r1"],
      }],
      verificationContracts: [],
    } as never);
    store.approve("iface-contract");
    store.approve("subject-contract");
    assert.equal(store.frontier, WorkflowStage.TestScenarios);
    return store;
  }

  const binding = {
    kind: "behavioral" as const,
    subjectId: "product",
    interfaceIds: ["iface"],
    boundaryRevisionId: "boundary-r1",
    interfaceContractRevisionIds: ["iface-r1"],
    subjectContractRevisionId: "subject-r1",
  };

  function scenarioProposal(
    title: string,
    { description = "Watering overdue path.", criteria = ["ac-1"] } = {},
  ) {
    return {
      items: [{
        key: "a",
        id: "scenario-1",
        title,
        description,
        priority: "p0" as const,
        acceptanceCriteriaIds: criteria,
        binding,
        dependencies: [],
      }],
    };
  }

  function caseDefinition(scenarioRevisionId: string, trace: unknown[] = []) {
    return {
      kind: "behavioral",
      scenarioRevisionId,
      subjectId: "product",
      initialFixture: {},
      trace,
      boundaryRevisionId: "boundary-r1",
      interfaceContractRevisionIds: ["iface-r1"],
      subjectContractRevisionId: "subject-r1",
    } as never;
  }

  function caseProposal(description: string, scenarioId: string, definition: unknown) {
    return {
      scenarioId,
      items: [{
        key: "c",
        id: "case-1",
        title: "Overdue reminder",
        description,
        priority: "p0" as const,
        acceptanceCriteriaIds: ["ac-1"],
        definition: definition as never,
        dependencies: [],
      }],
    };
  }

  function storeWithApprovedScenario(): FlatStore {
    const store = storeWithContracts();
    applyTestScenarioProposal(store, scenarioProposal("Overdue watering"));
    store.approve("scenario-1");
    assert.equal(store.frontier, WorkflowStage.TestCases);
    return store;
  }

  it("carries scenario approval and revision across an identical rewrite", () => {
    const store = storeWithApprovedScenario();
    const revisionId = store.testScenarios[0]!.revisionId;
    applyTestScenarioProposal(store, scenarioProposal("Overdue watering"));
    assert.equal(store.approvalOf("scenario-1"), "approved");
    assert.equal(store.testScenarios[0]!.revisionId, revisionId);
  });

  it("drafts a changed scenario and restores its signed version", () => {
    const store = storeWithApprovedScenario();
    const revisionId = store.testScenarios[0]!.revisionId;
    applyTestScenarioProposal(store, scenarioProposal("Missed watering"));
    assert.equal(store.approvalOf("scenario-1"), "draft");
    assert.notEqual(store.testScenarios[0]!.revisionId, revisionId);
    assert.equal(store.signedTextOf("scenario-1"), "Overdue watering");
    store.restoreSigned("scenario-1");
    assert.equal(store.approvalOf("scenario-1"), "approved");
    assert.equal(store.testScenarios[0]!.revisionId, revisionId);
  });

  it("drafts a scenario whose description changed under the signed title", () => {
    const store = storeWithApprovedScenario();
    applyTestScenarioProposal(
      store,
      scenarioProposal("Overdue watering", { description: "Something entirely different." }),
    );
    assert.equal(store.approvalOf("scenario-1"), "draft");
  });

  it("carries case approval and generated status across an identical rewrite", () => {
    const store = storeWithApprovedScenario();
    const scenario = store.testScenarios[0]!;
    const definition = caseDefinition(scenario.revisionId);
    applyTestCaseProposal(store, caseProposal("Reminder shows.", scenario.id, definition));
    const testCase = scenario.testCases[0]!;
    store.approve(testCase.id);
    testCase.markGenerated(testCase.inputFingerprint!);
    applyTestCaseProposal(store, caseProposal("Reminder shows.", scenario.id, definition));
    assert.equal(store.approvalOf("case-1"), "approved");
    assert.equal(scenario.testCases[0]!.testStatus, "generated");
  });

  it("drafts a case whose definition changed under the signed description", () => {
    const store = storeWithApprovedScenario();
    const scenario = store.testScenarios[0]!;
    applyTestCaseProposal(
      store,
      caseProposal("Reminder shows.", scenario.id, caseDefinition(scenario.revisionId)),
    );
    const testCase = scenario.testCases[0]!;
    store.approve(testCase.id);
    testCase.markGenerated(testCase.inputFingerprint!);
    const revisionId = testCase.revisionId;
    applyTestCaseProposal(
      store,
      caseProposal(
        "Reminder shows.",
        scenario.id,
        caseDefinition(scenario.revisionId, [{ kind: "input", alias: "tick" }]),
      ),
    );
    // Its generated test is later work; the change applies, and the test goes out of sync.
    assert.equal(store.approvalOf("case-1"), "draft");
    assert.notEqual(scenario.testCases[0]!.revisionId, revisionId);
    assert.equal(scenario.testCases[0]!.testStatus, "out-of-sync");
  });
});
