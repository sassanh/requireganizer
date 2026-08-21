import { toGenerator } from "mobx-state-tree";

import { Step } from "store";
import type { TestScenario } from "store/models";

import {
  applyTestCaseProposal,
  consumeHarnessResult,
  generator,
  runAiOperation,
} from "./utilities";

export default generator(
  function* generateTestCases(self, target?: TestScenario) {
    const scenarios = target == null ? [...self.testScenarios] : [target];
    for (const scenario of scenarios) {
      if (scenario.binding == null) throw new Error(`Scenario ${scenario.id} has no contract binding.`);
      const result = yield* toGenerator(runAiOperation(self, "generate-contract-test-cases", {
        state: self.json(Step.TestCases),
        design: self.boundaryDesign,
        suite: self.contractSuite,
        scenario: {
          id: scenario.id,
          revisionId: scenario.revisionId,
          title: scenario.content,
          description: scenario.description,
          acceptanceCriteriaIds: scenario.references
            .filter(({ type }) => type === "acceptance_criteria")
            .map(({ id }) => id),
          binding: scenario.binding,
        },
        existingIds: scenario.testCases.map(({ id }) => id),
      }));
      const proposal = consumeHarnessResult(self, result);
      if (proposal == null) return;
      applyTestCaseProposal(self, proposal);
      if (self.pendingImpactChange != null) return;
    }
    self.eventTarget.emit("stepUpdate", Step.TestCases);
  },
  {
    operation: "generate test cases",
    requirements: ["boundaryDesign", "contractSuite", "testScenarios"],
    requiredSteps: [Step.TestScenarios],
  },
);
