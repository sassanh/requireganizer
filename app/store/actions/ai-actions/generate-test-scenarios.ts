import { toGenerator } from "mobx-state-tree";

import { Step } from "store";

import { generator } from "./utilities";

export default generator(
  function* generateTestScenarios(self) {
    const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
    yield* toGenerator(runAgentCommand(self, "generate test scenarios", {
      kind: "generate",
      stage: Step.TestScenarios,
    }));
    self.eventTarget.emit("stepUpdate", Step.TestScenarios);
  },
  {
    operation: "generate test scenarios",
    requirements: ["boundaryDesign", "contractSuite"],
    requiredSteps: [Step.InterfaceContracts],
  },
);
