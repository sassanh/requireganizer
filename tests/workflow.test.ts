import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAgentSystemPrompt } from "../app/ai-agent/system-prompt";
import { CANONICAL_WORKFLOW } from "../app/ai-harness/workflow";
import {
  GENERATION_PREREQUISITE_BY_WORKFLOW_STAGE,
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
});
