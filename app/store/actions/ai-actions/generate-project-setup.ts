import { toGenerator } from "mobx-state-tree";

import { Step } from "store";

import {
  applyProjectSetupProposal,
  consumeHarnessResult,
  generator,
  runAiOperation,
} from "./utilities";

export default generator(
  function* generateProjectSetup(self) {
    const result = yield* toGenerator(runAiOperation(self, "generate-project-setup", {
      state: self.json(Step.ProjectSetup),
      design: self.boundaryDesign,
      profile: self.implementationProfile,
      suite: self.contractSuite,
      scenarioIds: self.testScenarios.map(({ id }) => id),
      testDesignFingerprint: self.testDesignFingerprint,
    }));
    const proposal = consumeHarnessResult(self, result);
    if (proposal == null) return;
    applyProjectSetupProposal(self, proposal);
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
