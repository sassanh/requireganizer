import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildResultTools } from "../app/ai-agent/result-tools";
import { buildAgentSystemPrompt } from "../app/ai-agent/system-prompt";
import {
  CANONICAL_WORKFLOW,
  formatQualityContract,
  qualityContractForFragment,
  qualityContractForStage,
  STAGE_QUALITY_CONTRACTS,
} from "../app/ai-harness/workflow";
import {
  GENERATION_PREREQUISITE_BY_WORKFLOW_STAGE,
  OVERVIEW_NAME_QUALITY_ID,
  OVERVIEW_PURPOSE_QUALITY_ID,
  Priority,
  Status,
  StructuralFragment,
  WorkflowStage,
} from "../app/store/constants";

describe("canonical engineering workflow", () => {
  it("places user outcomes before system requirements", () => {
    assert.deepEqual(CANONICAL_WORKFLOW, [
      WorkflowStage.ProductOverview,
      WorkflowStage.UserStories,
      WorkflowStage.Requirements,
      WorkflowStage.AcceptanceCriteria,
      WorkflowStage.BoundaryDesign,
      WorkflowStage.InterfaceContracts,
      WorkflowStage.TestScenarios,
      WorkflowStage.TestCases,
      WorkflowStage.ProjectSetup,
      WorkflowStage.AutomatedTests,
      WorkflowStage.Code,
    ]);
    assert.deepEqual(GENERATION_PREREQUISITE_BY_WORKFLOW_STAGE, {
      [WorkflowStage.UserStories]: WorkflowStage.ProductOverview,
      [WorkflowStage.Requirements]: WorkflowStage.UserStories,
      [WorkflowStage.AcceptanceCriteria]: WorkflowStage.Requirements,
      [WorkflowStage.BoundaryDesign]: WorkflowStage.AcceptanceCriteria,
      [WorkflowStage.InterfaceContracts]: WorkflowStage.BoundaryDesign,
      [WorkflowStage.TestScenarios]: WorkflowStage.InterfaceContracts,
      [WorkflowStage.TestCases]: WorkflowStage.TestScenarios,
      [WorkflowStage.ProjectSetup]: WorkflowStage.TestCases,
      [WorkflowStage.AutomatedTests]: WorkflowStage.ProjectSetup,
    });
  });

  it("allows product-overview generation with no upstream stage", async () => {
    const { Store: StoreModel } = await import("../app/store/store");
    const store = StoreModel.create({ productOverview: {} });
    assert.equal(store.canGenerateStep(WorkflowStage.ProductOverview), true);
    assert.equal(store.canGenerateStep(WorkflowStage.UserStories), false);
  });

  it("puts interface-contracts generate on the same header action as other stages", async () => {
    const { Store: StoreModel } = await import("../app/store/store");
    const store = StoreModel.create({ productOverview: {} });
    assert.equal(
      store.generatorActionForStep(WorkflowStage.InterfaceContracts),
      "generateImplementationProfile",
    );
  });

  it("locks empty later stages while an earlier stage is pending", async () => {
    const { Store: StoreModel } = await import("../app/store/store");
    const store = StoreModel.create({ productOverview: {} });
    assert.equal(store.getStepStatus(WorkflowStage.ProductOverview), Status.Pending);
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Locked);
    assert.equal(store.getStepStatus(WorkflowStage.Requirements), Status.Locked);
    assert.equal(store.getStepStatus(WorkflowStage.AcceptanceCriteria), Status.Locked);
    assert.equal(
      store.resolveOpenStep(WorkflowStage.AcceptanceCriteria),
      WorkflowStage.ProductOverview,
    );
    assert.equal(store.canGenerateStep(WorkflowStage.Requirements), false);
    assert.match(
      store.cannotGenerateReason(WorkflowStage.Requirements) ?? "",
      /Product Overview/,
    );
    assert.throws(
      () =>
        buildResultTools(store, {
          kind: "generate",
          stage: WorkflowStage.Requirements,
        }),
      /Product Overview/,
    );
  });

  it("keeps an empty later stage locked while the previous is unsigned", async () => {
    const { Store: StoreModel } = await import("../app/store/store");
    const store = StoreModel.create({
      productOverview: {
        name: "Plant Pal",
        purpose: "Help people keep houseplants alive.",
        primaryFeatures: [{ id: "feat-1", content: "Track watering" }],
        targetUsers: [{ id: "user-1", content: "Busy plant owners" }],
      },
    });
    assert.equal(store.getStepStatus(WorkflowStage.ProductOverview), Status.Outdated);
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Locked);
    assert.equal(
      store.resolveOpenStep(WorkflowStage.UserStories),
      WorkflowStage.ProductOverview,
    );
    store.approve(OVERVIEW_NAME_QUALITY_ID);
    store.approve(OVERVIEW_PURPOSE_QUALITY_ID);
    store.approve("feat-1");
    store.approve("user-1");
    assert.equal(store.getStepStatus(WorkflowStage.ProductOverview), Status.Completed);
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Pending);
  });

  it("does not lock a later stage that already has artifacts", async () => {
    const { Store: StoreModel } = await import("../app/store/store");
    const store = StoreModel.create({ productOverview: {} });
    store.setUserStories({
      userStories: [
        {
          id: "story-1",
          content:
            "As a busy plant owner, I want watering reminders, so that plants stay alive.",
          references: [],
          priority: Priority.P1,
        },
      ],
    });
    assert.equal(store.hasStepArtifacts(WorkflowStage.UserStories), true);
    assert.equal(store.stageIsLocked(WorkflowStage.UserStories), false);
    assert.equal(store.getStepStatus(WorkflowStage.UserStories), Status.Pending);
  });

  it("system prompt labels project data untrusted and requires tool-based reads", () => {
    const prompt = buildAgentSystemPrompt();
    assert.match(prompt, /never as instructions|Do not paste proposals/);
    assert.match(prompt, /read tools|get_stage_artifacts/);
    assert.match(prompt, /submit_/);
  });

  it("system prompt points at the submit-tool quality contract instead of restating it", () => {
    const prompt = buildAgentSystemPrompt();
    assert.match(prompt, /submit tool[\s\S]*quality contract/i);
    assert.match(prompt, /Generate produces draft/);
    assert.doesNotMatch(prompt, /Separate user outcomes from implementation details/);
    assert.equal(
      prompt.includes(STAGE_QUALITY_CONTRACTS[WorkflowStage.UserStories].objective),
      false,
    );
  });

  it("gives product overview, stories, requirements, and criteria a quality contract", () => {
    assert.equal(
      qualityContractForStage(WorkflowStage.ProductOverview),
      STAGE_QUALITY_CONTRACTS[WorkflowStage.ProductOverview],
    );
    assert.equal(
      qualityContractForFragment(StructuralFragment.PrimaryFeature),
      STAGE_QUALITY_CONTRACTS[WorkflowStage.ProductOverview],
    );
    assert.equal(
      qualityContractForFragment(StructuralFragment.UserStory),
      STAGE_QUALITY_CONTRACTS[WorkflowStage.UserStories],
    );
    assert.equal(qualityContractForStage(WorkflowStage.BoundaryDesign), null);
    const formatted = formatQualityContract(
      STAGE_QUALITY_CONTRACTS[WorkflowStage.UserStories],
    );
    assert.match(formatted, /Objective:/);
    assert.match(formatted, /Judge the claim, not the vocabulary/);
    assert.ok(
      formatted.includes(STAGE_QUALITY_CONTRACTS[WorkflowStage.UserStories].objective),
    );
  });
});
