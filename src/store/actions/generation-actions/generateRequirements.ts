import { flow } from "mobx-state-tree";
import openai from "store/api";
import { Store } from "store/store";

import {
  generatePrompt,
  generator,
  prepareContent,
  systemPrompt,
} from "./utilities";

const generateRequirements = flow(function* (self_: unknown) {
  const self = self_ as Store;

  // Generate requirements
  const userStoriesResult = yield openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    n: 1,
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: systemPrompt },
      {
        role: "user",
        content: generatePrompt("user stories"),
      },
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
        content: `user stories: ${self.userStories
          .map(({ content }) => content)
          .join("\n")}`,
      },
    ],
  });
  const userStories = userStoriesResult.data.choices[0].message?.content;

  self.setUserStories(prepareContent(userStories));
}) as (self_: unknown) => Promise<void>;

export default generator(generateRequirements);
