import { toGenerator } from "mobx-state-tree";

import {
  GENERATE_REQUIREMENTS_ENDPOINT,
  GenerateRequirementsRequestBody,
  GenerateRequirementsResponseBody,
} from "@/api";
import { Iteration } from "store";

import { generator } from "./utilities";

export default generator(
  function* generateRequirements(self) {
    self.setRequirements([]);

    const requestBody: GenerateRequirementsRequestBody = {
      description: self.description,
      productOverview: self.productOverview,
      userStories: self.userStories,
    };

    const response: Response = yield* toGenerator(
      fetch(GENERATE_REQUIREMENTS_ENDPOINT, {
        method: "POST",
        body: JSON.stringify(requestBody),
      })
    );
    const { requirements } = (yield* toGenerator(
      response.json()
    )) as GenerateRequirementsResponseBody;

    self.setRequirements(requirements);
    self.eventTarget.emit("iterationUpdate", Iteration.requirements);
  },
  { requirements: ["description", "productOverview", "userStories"] }
);
