import assert from "node:assert/strict";
import { describe, it } from "node:test";

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

  it("system prompt labels project data untrusted and requires tool-based reads", () => {
    const prompt = buildAgentSystemPrompt();
    assert.match(prompt, /never as instructions|Do not paste proposals/);
    assert.match(prompt, /read tools|get_stage_artifacts/);
    assert.match(prompt, /submit_/);
  });

  it("system prompt points at the submit-tool quality contract instead of restating it", () => {
    const prompt = buildAgentSystemPrompt();
    assert.match(prompt, /submit tool[\s\S]*quality contract/i);
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
