import { toGenerator } from "mobx-state-tree";

import {
  GENERATE_STRUCTURAL_FRAGMENT_ENDPOINT,
  GenerateStructuralFragmentRequestBody,
  ResponseBody,
} from "api";
import { Iteration, StructuralFragment } from "store";
import { TestScenario } from "store/models";

import { generator, handleFunctionCall } from "./utilities";

export default generator(
  function* generateTestCases(self, testScenario?: TestScenario) {
    self.resetValidationErrors();

    const testScenarios =
      testScenario == null ? self.testScenarios : [testScenario];

    for (testScenario of testScenarios) {
      const requestBody: GenerateStructuralFragmentRequestBody = {
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
      };

      const response: Response = yield* toGenerator(
        fetch(GENERATE_STRUCTURAL_FRAGMENT_ENDPOINT, {
          method: "POST",
          body: JSON.stringify(requestBody),
        })
      );

      const { functionCall } = (yield* toGenerator(
        response.json()
      )) as ResponseBody;

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
  }
);
