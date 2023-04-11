import { toGenerator } from "mobx-state-tree";

import {
  GENERATE_USER_STORIES_ENDPOINT,
  GenerateUserStoriesRequestBody,
  GenerateUserStoriesResponseBody,
} from "api";
import { Iteration } from "store";

import { generator } from "./utilities";

export default generator(
  function* generateUserStories(self) {
    self.setUserStories([]);

    const requestBody: GenerateUserStoriesRequestBody = {
      description: self.description,
      productOverview: self.productOverview,
    };

    const response: Response = yield* toGenerator(
      fetch(GENERATE_USER_STORIES_ENDPOINT, {
        method: "POST",
        body: JSON.stringify(requestBody),
      })
    );
    const { userStories } = (yield* toGenerator(
      response.json()
    )) as GenerateUserStoriesResponseBody;

    self.setUserStories(userStories);
    self.eventTarget.emit("iterationUpdate", Iteration.userStories);
  },
  { requirements: ["description", "productOverview"] }
);
