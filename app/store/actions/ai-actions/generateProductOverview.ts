import { toGenerator } from "mobx-state-tree";

import { GENERATE_PRODUCT_OVERVIEW_ENDPOINT, RequestBody, ResponseBody } from "api";
import { Iteration } from "store";

import { generator, handleFunctionCall } from "./utilities";

export default generator(
  function* generateProductOverview(self) {
    self.resetValidationErrors();

    self.productOverview = null;
    self.framework = null;
    self.programmingLanguage = null;

    const requestBody: RequestBody = {
      state: self.json(Iteration.productOverview),
    };

    const response: Response = yield* toGenerator(
      fetch(GENERATE_PRODUCT_OVERVIEW_ENDPOINT, {
        method: "POST",
        body: JSON.stringify(requestBody),
      })
    );

    const { functionCall } = (yield* toGenerator(
      response.json()
    )) as ResponseBody;

    handleFunctionCall(self, functionCall);

    self.eventTarget.emit("iterationUpdate", Iteration.productOverview);
  },
  { requirements: ["description"] }
);
