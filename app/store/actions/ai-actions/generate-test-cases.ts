import { toGenerator } from "mobx-state-tree";

import { generateStructuralFragment } from "actions/ai/generate-structural-fragment";
import { Step, StructuralFragment } from "store";
import { TestScenario } from "store/models";

import { generator, handleFunctionCall } from "./utilities";

export default generator(
  function* generateTestCases(self, testScenario?: TestScenario) {
    self.resetValidationErrors();

    const testScenarios =
      testScenario == null ? self.testScenarios : [testScenario];

    for (testScenario of testScenarios) {
      const { functionCall } = yield* toGenerator(
        generateStructuralFragment({
          state: JSON.stringify({
            ...self.data(),
            testScenarios: self.testScenarios.map((testScenario_) => ({
              ...testScenario_,
              testCases:
                testScenario_ === testScenario
                  ? testScenario_.testCases
                  : "[these test cases are excluded from state as they are not needed for this query]",
            })),
          }),
          parentId: testScenario.id,
          structuralFragment: StructuralFragment.TestCase,
        }),
      );

      handleFunctionCall(self, functionCall);

      self.eventTarget.emit("stepUpdate", Step.TestCases);
    }
  },
  {
    requirements: [
      "description",
      "productOverview",
      "userStories",
      "requirements",
      "acceptanceCriteria",
      "testScenarios",
    ],
  },
);
