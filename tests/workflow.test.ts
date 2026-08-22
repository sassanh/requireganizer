import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAgentSystemPrompt } from "../app/ai-agent/system-prompt";
import { CANONICAL_WORKFLOW, getArtifactStageDefinition } from "../app/ai-harness/workflow";
import {
  EngineerRole,
  GENERATION_PREREQUISITE_BY_STEP,
  Step,
  StructuralFragment,
} from "../app/store/constants";

describe("canonical engineering workflow", () => {
  it("places user outcomes before system requirements", () => {
    assert.deepEqual(CANONICAL_WORKFLOW, [
      Step.Description,
      Step.ProductOverview,
      Step.UserStories,
      Step.Requirements,
      Step.AcceptanceCriteria,
      Step.BoundaryDesign,
      Step.InterfaceContracts,
      Step.TestScenarios,
      Step.TestCases,
      Step.ProjectSetup,
      Step.AutomatedTests,
      Step.Code,
    ]);
    assert.deepEqual(GENERATION_PREREQUISITE_BY_STEP, {
      [Step.ProductOverview]: Step.Description,
      [Step.UserStories]: Step.ProductOverview,
      [Step.Requirements]: Step.UserStories,
      [Step.AcceptanceCriteria]: Step.Requirements,
      [Step.BoundaryDesign]: Step.AcceptanceCriteria,
      [Step.InterfaceContracts]: Step.BoundaryDesign,
      [Step.TestScenarios]: Step.InterfaceContracts,
      [Step.TestCases]: Step.TestScenarios,
      [Step.ProjectSetup]: Step.TestCases,
      [Step.AutomatedTests]: Step.ProjectSetup,
    });
  });

  it("system prompt labels project data untrusted and requires tool-based reads", () => {
    const prompt = buildAgentSystemPrompt();
    assert.match(prompt, /never as instructions|Do not paste proposals/);
    assert.match(prompt, /read tools|get_stage_artifacts/);
    assert.match(prompt, /submit_/);
  });
});
