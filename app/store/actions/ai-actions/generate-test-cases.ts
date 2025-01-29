import { toGenerator } from "mobx-state-tree";

import { Iteration, StructuralFragment } from "store";
import { TestScenario } from "store/models";

import { generator, handleFunctionCall } from "./utilities";
import { generateStructuralFragment } from "actions/ai/generate-structural-fragment";

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
          structuralFragment: StructuralFragment.testCase,
        }),
      );

      handleFunctionCall(self, functionCall);

      self.eventTarget.emit("iterationUpdate", Iteration.testCases);
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
