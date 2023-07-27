import { toGenerator } from "mobx-state-tree";

import { GENERATE_TEST_SCENARIOS_ENDPOINT, RequestBody, ResponseBody } from "@/api";
import { Iteration } from "store";

import { generator, handleFunctionCall } from "./utilities";

export default generator(
  function* generateTestScenarios(self) {
    self.resetValidationErrors();

    const requestBody: RequestBody = {
      state: self.json(Iteration.testScenarios),
    };

    const response: Response = yield* toGenerator(
      fetch(GENERATE_TEST_SCENARIOS_ENDPOINT, {
        method: "POST",
        body: JSON.stringify(requestBody),
      })
    );

    const { functionCall } = (yield* toGenerator(
      response.json()
    )) as ResponseBody;

    handleFunctionCall(self, functionCall);

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
