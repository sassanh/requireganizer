import { flow } from "mobx-state-tree";
import ai from "store/api";
import { Store } from "store/store";
import { Iteration } from "store/utilities";

import {
  generatePrompt,
  generator,
  prepareContent,
  systemPrompt,
} from "./utilities";

const generateUserStories = flow(function* (self_: unknown) {
  const self = self_ as Store;

  // Generate user stories
  const result = yield ai.createChatCompletion({
    model: "gpt-3.5-turbo",
    n: 1,
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `description: ${self.description}`,
      },
      {
        role: "user",
        content: `product overview: ${self.productOverview}`,
      },
      {
        role: "user",
        content: generatePrompt("user stories"),
      },
      {
        role: "user",
        content: 'Each user story should start with "As a"',
      },
    ],
  });
  const userStories = result.data.choices[0].message?.content;

  self.setUserStories(prepareContent(userStories));
  self.eventTarget.emit("iterationUpdate", Iteration.userStories);
}) as (self_: unknown) => Promise<void>;

export default generator(generateUserStories);
