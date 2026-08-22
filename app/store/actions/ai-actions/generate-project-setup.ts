import { toGenerator } from "mobx-state-tree";

import { Step } from "store";

import { generator } from "./utilities";

export default generator(
  function* generateProjectSetup(self) {
const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
        yield* toGenerator(runAgentCommand(self, "generate project setup", {
      kind: "generate",
      stage: Step.ProjectSetup,
    }));
    self.eventTarget.emit("stepUpdate", Step.ProjectSetup);
  },
  {
    operation: "generate project setup",
    requirements: [
      "boundaryDesign",
      "implementationProfile",
      "contractSuite",
      "testScenarios",
    ],
    requiredSteps: [Step.TestCases],
  },
);
