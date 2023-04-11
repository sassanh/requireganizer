import { toGenerator } from "mobx-state-tree";

import { GENERATE_PRODUCT_OVERVIEW_ENDPOINT } from "@/api";
import { Iteration } from "@/store/constants";

import { generator } from "./utilities";

export default generator(
  function* generateProductOverview(self) {
    self.resetValidationErrors();

    self.productOverview = null;
    self.framework = null;
    self.programmingLanguage = null;

    const requestBody = { description: self.description };

    const response: Response = yield* toGenerator(
      fetch(GENERATE_PRODUCT_OVERVIEW_ENDPOINT, {
        method: "POST",
        body: JSON.stringify(requestBody),
      })
    );

    const { productOverview, framework, programmingLanguage } =
      yield* toGenerator(response.json());

    self.setProductOverview(productOverview);
    self.setFramework(framework);
    self.setProgrammingLanguage(programmingLanguage);

    self.eventTarget.emit("iterationUpdate", Iteration.productOverview);
  },
  { requirements: ["description"] }
);
