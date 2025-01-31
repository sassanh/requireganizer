import { cast, toGenerator } from "mobx-state-tree";

import { generateProductOverview } from "actions/ai/generate-product-overview";
import { Iteration } from "store";

import { generator, handleFunctionCall } from "./utilities";

export default generator(
  function* (self) {
    self.resetValidationErrors();

    self.productOverview.name = null;
    self.productOverview.purpose = null;
    self.productOverview.primaryFeatures = cast([]);
    self.productOverview.targetUsers = cast([]);
    self.productOverview.framework = null;
    self.productOverview.programmingLanguage = null;

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
