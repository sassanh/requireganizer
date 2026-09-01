import { toGenerator } from "mobx-state-tree";

import { UserFacingError } from "lib/errors";
import { WorkflowStage } from "store";
import type { TestScenario } from "store/models";

import { generator } from "./utilities";

export default generator(
  function* generateTestCases(self, target?: TestScenario) {
    const scenarios = target == null ? [...self.testScenarios] : [target];
    for (const scenario of scenarios) {
      if (scenario.approval !== "approved") {
        throw new UserFacingError("Approve this scenario before generating its cases.");
      }
      if (scenario.binding == null) throw new Error(`Scenario ${scenario.id} has no contract binding.`);
const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
            yield* toGenerator(runAgentCommand(self, "generate test cases", {
        kind: "generate",
        stage: WorkflowStage.TestCases,
        scenarioId: scenario.id,
      }));
      if (self.pendingImpactChange != null) return;
    }
    self.eventTarget.emit("stepUpdate", WorkflowStage.TestCases);
  },
  {
    operation: "generate test cases",
    requirements: ["boundaryDesign", "contractSuite", "testScenarios"],
    requiredSteps: [WorkflowStage.TestScenarios],
  },
);
