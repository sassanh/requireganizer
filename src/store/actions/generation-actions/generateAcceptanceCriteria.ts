import { flow } from "mobx-state-tree";
import { Store } from "store";
import ai from "store/api";
import { Iteration } from "store/utilities";

import {
  generatePrompt,
  generator,
  prepareContent,
  systemPrompt,
} from "./utilities";

const generateAcceptanceCriteria = flow(function* (self_: unknown) {
  const self = self_ as Store;

  // Generate acceptance criteria
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
        content: `user stories: ${self.userStories
          .map(({ content }) => `- ${content}`)
          .join("\n")}`,
      },
      {
        role: "user",
        content: `requirements: ${self.requirements
          .map(({ content }) => `- ${content}`)
          .join("\n")}`,
      },
      {
        role: "user",
        content: generatePrompt("acceptance criteria"),
      },
    ],
  });
  const acceptanceCriteria = result.data.choices[0].message?.content;

  self.setAcceptanceCriteria(prepareContent(acceptanceCriteria));
  self.eventTarget.emit("iterationUpdate", Iteration.acceptanceCriteria);
}) as (self_: unknown) => Promise<void>;

export default generator(generateAcceptanceCriteria);
