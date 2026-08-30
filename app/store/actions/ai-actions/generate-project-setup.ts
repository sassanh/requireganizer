import { toGenerator } from "mobx-state-tree";

import { WorkflowStage } from "store";

import { generator } from "./utilities";

export default generator(
  function* generateProjectSetup(self) {
const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
        yield* toGenerator(runAgentCommand(self, "generate project setup", {
      kind: "generate",
      stage: WorkflowStage.ProjectSetup,
    }));
    self.eventTarget.emit("stepUpdate", WorkflowStage.ProjectSetup);
  },
  {
    operation: "generate project setup",
    requirements: [
      "boundaryDesign",
      "implementationProfile",
      "contractSuite",
      "testScenarios",
    ],
    requiredSteps: [WorkflowStage.TestCases],
  },
);
