import { toGenerator } from "mobx-state-tree";

import { generateProjectConfig } from "actions/ai/generate-project-config";
import { Step } from "store";

import {
  applyProjectConfigurationProposal,
  consumeHarnessResult,
  generator,
} from "./utilities";

export default generator(
  function* (self) {
    const result = yield* toGenerator(
      generateProjectConfig({
        state: self.json(Step.TestCases),
      }),
    );

    const config = consumeHarnessResult(self, result);
    if (config == null) return;
    applyProjectConfigurationProposal(self, config);
  },
  {
    operation: "generate the project configuration",
    requirements: [
      "description",
      "productOverview",
      "userStories",
      "requirements",
      "acceptanceCriteria",
      "testScenarios",
    ],
    requiredSteps: [Step.TestCases],
  },
);
