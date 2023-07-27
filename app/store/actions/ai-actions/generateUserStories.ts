import { toGenerator } from "mobx-state-tree";

import { GENERATE_USER_STORIES_ENDPOINT, RequestBody, ResponseBody } from "api";
import { Iteration } from "store";

import { generator, handleFunctionCall } from "./utilities";

export default generator(
  function* generateUserStories(self) {
    self.resetValidationErrors();

    const requestBody: RequestBody = {
      state: self.json(Iteration.userStories),
    };

    const response: Response = yield* toGenerator(
      fetch(GENERATE_USER_STORIES_ENDPOINT, {
        method: "POST",
        body: JSON.stringify(requestBody),
      })
    );

    const { functionCall } = (yield* toGenerator(
      response.json()
    )) as ResponseBody;

    handleFunctionCall(self, functionCall);

    self.eventTarget.emit("iterationUpdate", Iteration.userStories);
  },
  { requirements: ["description", "productOverview"] }
);
