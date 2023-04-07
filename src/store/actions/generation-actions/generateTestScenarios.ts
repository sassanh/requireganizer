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

const generateTestScenarios = flow(function* (self_: unknown) {
  const self = self_ as Store;

  // Generate test scenarios
  const userStoriesResult = yield ai.createChatCompletion({
    model: "gpt-3.5-turbo",
    n: 1,
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: systemPrompt },
      {
        role: "user",
        content: generatePrompt("test scenarios"),
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
      {
        role: "user",
        content: `requirements: ${self.requirements
          .map(({ content }) => content)
          .join("\n")}`,
      },
      {
        role: "user",
        content: `test scenarios: ${self.testScenarios
          .map(
            ({ content, testCases }, index) => `${index}. ${content}
${testCases.map(({ content }) => `- ${content}`).join("\n")}`
          )
          .join("\n")}`,
      },
    ],
  });
  const testScenarios = userStoriesResult.data.choices[0].message?.content;

  self.setTestScenarios(prepareContent(testScenarios));
  self.eventTarget.emit("iterationUpdate", Iteration.testScenarios);
}) as (self_: unknown) => Promise<void>;

export default generator(generateTestScenarios);
