import { toGenerator } from "mobx-state-tree";

import { Iteration } from "store";

import { generator, handleFunctionCall } from "./utilities";
import { generateProductOverview } from "actions/ai/generate-product-overview";

export default generator(
  function* (self) {
    self.resetValidationErrors();

    self.productOverview = null;
    self.framework = null;
    self.programmingLanguage = null;

    const { functionCall } = yield* toGenerator(
      generateProductOverview({
        state: self.json(Iteration.productOverview),
      }),
    );

    handleFunctionCall(self, functionCall);

    self.eventTarget.emit("iterationUpdate", Iteration.productOverview);
  },
  { requirements: ["description"] },
);
