import { toGenerator } from "mobx-state-tree";

import { GENERATE_ACCEPTANCE_CRITERIA_ENDPOINT, RequestBody, ResponseBody } from "@/api";
import { Iteration } from "store";

import { generator, handleFunctionCall } from "./utilities";

export default generator(
  function* generateAcceptanceCriteria(self) {
    self.resetValidationErrors();

    const requestBody: RequestBody = {
      state: self.json(Iteration.acceptanceCriteria),
    };

    const response: Response = yield* toGenerator(
      fetch(GENERATE_ACCEPTANCE_CRITERIA_ENDPOINT, {
        method: "POST",
        body: JSON.stringify(requestBody),
      })
    );

    const { functionCall } = (yield* toGenerator(
      response.json()
    )) as ResponseBody;

    handleFunctionCall(self, functionCall);

    self.eventTarget.emit("iterationUpdate", Iteration.acceptanceCriteria);
  },
  {
    requirements: [
      "description",
      "productOverview",
      "userStories",
      "requirements",
    ],
  }
);
