import { toGenerator } from "mobx-state-tree";

import { generateContractTestScenarios } from "actions/ai/generate-contract-test-scenarios";
import { Step } from "store";

import { applyTestScenarioProposal, consumeHarnessResult, generator } from "./utilities";

export default generator(
  function* generateTestScenarios(self) {
    const result = yield* toGenerator(generateContractTestScenarios({
      state: self.json(Step.TestScenarios),
      design: self.boundaryDesign,
      suite: self.contractSuite,
      existingIds: self.testScenarios.map(({ id }) => id),
    }));
    const proposal = consumeHarnessResult(self, result);
    if (proposal == null) return;
    applyTestScenarioProposal(self, proposal);
    self.eventTarget.emit("stepUpdate", Step.TestScenarios);
  },
  {
    operation: "generate test scenarios",
    requirements: ["boundaryDesign", "contractSuite"],
    requiredSteps: [Step.InterfaceContracts],
  },
);
