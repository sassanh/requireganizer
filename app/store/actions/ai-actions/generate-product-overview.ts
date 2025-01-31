import { cast, toGenerator } from "mobx-state-tree";

import { generateProductOverview } from "actions/ai/generate-product-overview";
import { Step } from "store";

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
        state: self.json(Step.ProductOverview),
      }),
    );

    handleFunctionCall(self, functionCall);

    self.eventTarget.emit("stepUpdate", Step.ProductOverview);
  },
  { requirements: ["description"] },
);
