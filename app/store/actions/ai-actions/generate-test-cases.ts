import { generator, handleFunctionCalls } from "./utilities";
import { generateStructuralFragment } from "actions/ai/generate-structural-fragment";
import { toGenerator } from "mobx-state-tree";
import { Step, StructuralFragment } from "store";
import { TestScenario } from "store/models";

export default generator(
  function* generateTestCases(self, testScenario?: TestScenario) {
    self.resetValidationErrors();

    const testScenarios =
      testScenario == null ? self.testScenarios : [testScenario];

    for (testScenario of testScenarios) {
      const { functionCalls } = yield* toGenerator(
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

      console.log(functionCalls);
      handleFunctionCalls(self, functionCalls);
    }
    self.eventTarget.emit("stepUpdate", Step.TestCases);
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
