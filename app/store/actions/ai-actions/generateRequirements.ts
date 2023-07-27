import { toGenerator } from "mobx-state-tree";

import { GENERATE_REQUIREMENTS_ENDPOINT, RequestBody, ResponseBody } from "@/api";
import { Iteration } from "store";

import { generator, handleFunctionCall } from "./utilities";

export default generator(
  function* generateRequirements(self) {
    self.resetValidationErrors();

    const requestBody: RequestBody = {
      state: self.json(Iteration.requirements),
    };

    const response: Response = yield* toGenerator(
      fetch(GENERATE_REQUIREMENTS_ENDPOINT, {
        method: "POST",
        body: JSON.stringify(requestBody),
      })
    );

    const { functionCall } = (yield* toGenerator(
      response.json()
    )) as ResponseBody;

    handleFunctionCall(self, functionCall);

    self.eventTarget.emit("iterationUpdate", Iteration.requirements);
  },
  { requirements: ["description", "productOverview", "userStories"] }
);
