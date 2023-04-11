import { toGenerator } from "mobx-state-tree";

import { Iteration } from "@/store/constants";
import {
  GENERATE_ACCEPTANCE_CRITERIA_ENDPOINT,
  GenerateAcceptanceCriteriaRequestBody,
  GenerateAcceptanceCriteriaResponseBody,
} from "api";

import { generator } from "./utilities";

export default generator(
  function* generateAcceptanceCriteria(self) {
    self.setAcceptanceCriteria([]);

    const requestBody: GenerateAcceptanceCriteriaRequestBody = {
      description: self.description,
      productOverview: self.productOverview,
      userStories: self.userStories,
      requirements: self.requirements,
    };

    const response: Response = yield* toGenerator(
      fetch(GENERATE_ACCEPTANCE_CRITERIA_ENDPOINT, {
        method: "POST",
        body: JSON.stringify(requestBody),
      })
    );
    const { acceptanceCriteria } = (yield* toGenerator(
      response.json()
    )) as GenerateAcceptanceCriteriaResponseBody;

    self.setAcceptanceCriteria(acceptanceCriteria);
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
