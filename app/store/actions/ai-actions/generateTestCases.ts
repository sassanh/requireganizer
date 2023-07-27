import { toGenerator } from "mobx-state-tree";

import {
  GENERATE_TEST_CASES_ENDPOINT,
  GenerateTestCasesRequestBody,
  ResponseBody
} from "@/api";
import { Iteration } from "store";
import { TestScenario } from "store/models";

import { generator, handleFunctionCall } from "./utilities";

export default generator(
  function* generateTestCases(self, testScenario?: TestScenario) {
    self.resetValidationErrors();

    const testScenarios =
      testScenario == null ? self.testScenarios : [testScenario];

    for (testScenario of testScenarios) {
      const requestBody: GenerateTestCasesRequestBody = {
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
        testScenarioIndex: self.testScenarios.indexOf(testScenario),
      };

      const response: Response = yield* toGenerator(
        fetch(GENERATE_TEST_CASES_ENDPOINT, {
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
