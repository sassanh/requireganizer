import { toGenerator } from "mobx-state-tree";

import { UserFacingError } from "lib/errors";
import { WorkflowStage } from "store";

import { generator } from "./utilities";

export default generator(
  function* generateTestCases(self, scenarioId: string | null = null, hint?: string) {
    const target = scenarioId == null
      ? null
      : self.testScenarios.find((scenario) => scenario.id === scenarioId);
    if (target === undefined) throw new UserFacingError("The scenario no longer exists.");
    const scenarios = target == null ? [...self.testScenarios] : [target];
    const trimmedHint = hint?.trim();
    for (const scenario of scenarios) {
      if (scenario.binding == null) throw new Error(`Scenario ${scenario.id} has no contract binding.`);
const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
            yield* toGenerator(runAgentCommand(self, "generate test cases", {
        kind: "generate",
        stage: WorkflowStage.TestCases,
        scenarioId: scenario.id,
        ...(trimmedHint != null && trimmedHint.length > 0 ? { hint: trimmedHint } : {}),
      }));
    }
    self.eventTarget.emit("stepUpdate", WorkflowStage.TestCases);
  },
  {
    operation: "generate test cases",
    requirements: ["boundaryDesign", "contractSuite", "testScenarios"],
    targetStep: WorkflowStage.TestCases,
  },
);
