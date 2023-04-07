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

const generateTestCases = flow(function* (self_: unknown) {
  const self = self_ as Store;

  // Generate test cases
  const result = yield ai.createChatCompletion({
    model: "gpt-3.5-turbo",
    n: 1,
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: systemPrompt },
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
        content: `acceptance criteria: ${self.acceptanceCriteria
          .map(({ content }) => content)
          .join("\n")}`,
      },
      {
        role: "user",
        content: generatePrompt("test cases"),
      },
      {
        role: "user",
        content:
          "For each test scenario, generate test cases. Each test case should start with 5 ampersands like this \"&&&&&\". Write test cases in multiple lines when needed. If a test case has steps, add numerical indices for each step. Do not include any other titles or headings like 'Test Scenarios:' or 'Test Cases:', and just provide the test cases.",
      },
    ],
  });
  const testScenarios = result.data.choices[0].message?.content;

  self.setTestScenarios(
    prepareContent(testScenarios).map(({ content }) => ({
      content: content.split("&&&&&")[0].trim(),
      testCases: prepareContent(content, "&&&&&"),
    }))
  );
  self.eventTarget.emit("iterationUpdate", Iteration.testScenarios);
}) as (self_: unknown) => Promise<void>;

export default generator(generateTestCases);
