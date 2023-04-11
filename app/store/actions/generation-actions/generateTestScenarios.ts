import { toGenerator } from "mobx-state-tree";

import {
  GENERATE_TEST_SCENARIOS_ENDPOINT,
  GenerateTestScenariosRequestBody,
  GenerateTestScenariosResponseBody,
} from "@/api";
import { Iteration } from "@/store/constants";

import { generator } from "./utilities";

export default generator(
  function* generateTestScenarios(self) {
    self.setTestScenarios([]);

    const requestBody: GenerateTestScenariosRequestBody = {
      description: self.description,
      productOverview: self.productOverview,
      userStories: self.userStories,
      requirements: self.requirements,
      acceptanceCriteria: self.acceptanceCriteria,
    };

    const response: Response = yield* toGenerator(
      fetch(GENERATE_TEST_SCENARIOS_ENDPOINT, {
        method: "POST",
        body: JSON.stringify(requestBody),
      })
    );
    const { testScenarios } = (yield* toGenerator(
      response.json()
    )) as GenerateTestScenariosResponseBody;

    self.setTestScenarios(testScenarios);
    self.eventTarget.emit("iterationUpdate", Iteration.testScenarios);
  },
  {
    requirements: [
      "description",
      "productOverview",
      "userStories",
      "requirements",
      "acceptanceCriteria",
    ],
  }
);
