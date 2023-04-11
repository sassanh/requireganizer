import { toGenerator } from "mobx-state-tree";

import {
  GENERATE_TEST_CASES_ENDPOINT,
  GenerateTestCasesRequestBody,
  GenerateTestCasesResponseBody,
} from "@/api";
import { Iteration } from "@/store/constants";
import { Store } from "@/store/store";
import { TestScenario } from "store/models";

import { generator } from "./utilities";

export default generator(
  function* generateTestCases(self, testScenario?: TestScenario) {
    if (testScenario != null) {
      testScenario.setTestCases([]);

      const requestBody: GenerateTestCasesRequestBody = {
        description: self.description,
        productOverview: self.productOverview,
        userStories: self.userStories,
        requirements: self.requirements,
        acceptanceCriteria: self.acceptanceCriteria,
        testScenarios: self.testScenarios,
        testScenarioIndex: self.testScenarios.indexOf(testScenario),
      };

      const response: Response = yield* toGenerator(
        fetch(GENERATE_TEST_CASES_ENDPOINT, {
          method: "POST",
          body: JSON.stringify(requestBody),
        })
      );
      const { testCases } = (yield* toGenerator(
        response.json()
      )) as GenerateTestCasesResponseBody;

      testScenario?.setTestCases(testCases);
      self.eventTarget.emit("iterationUpdate", Iteration.testCases);
    } else {
      self.testScenarios.forEach((testScenario) =>
        (self as Store).generateTestCases(testScenario)
      );
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
