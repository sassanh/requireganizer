import { toGenerator } from "mobx-state-tree";

import { WorkflowStage } from "store";

import { generator } from "./utilities";

export default generator(
  function* generateTestScenarios(self) {
    const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
    yield* toGenerator(runAgentCommand(self, "generate test scenarios", {
      kind: "generate",
      stage: WorkflowStage.TestScenarios,
    }));
    self.eventTarget.emit("stepUpdate", WorkflowStage.TestScenarios);
  },
  {
    operation: "generate test scenarios",
    requirements: ["boundaryDesign", "contractSuite"],
    requiredSteps: [WorkflowStage.InterfaceContracts],
  },
);
