import { toGenerator } from "mobx-state-tree";

import { generateScaffold } from "actions/ai/generate-scaffold";
import { UserFacingError } from "lib/errors";
import { parseJsoncObject } from "lib/json";
import { Step } from "store";

import {
  applyScaffoldProposal,
  consumeHarnessResult,
  generator,
} from "./utilities";

export default generator(
  function* (self) {
    if (!self.projectConfig) {
      throw new UserFacingError(
        "A project configuration is required before generating the scaffold.",
      );
    }
    if (self.isProjectConfigOutdated) {
      throw new UserFacingError(
        "The specification changed. Regenerate the project configuration before generating the scaffold.",
      );
    }

    const config = parseJsoncObject(
      self.projectConfig,
      "Project configuration",
    );

    self.clearMessage();

    const result = yield* toGenerator(
      generateScaffold({
        config,
        state: self.json(Step.TestCases),
      }),
    );

    const proposal = consumeHarnessResult(self, result);
    if (proposal == null) return;
    applyScaffoldProposal(self, proposal);
  },
  {
    operation: "generate the project scaffold",
    requirements: [
      "description",
      "productOverview",
      "userStories",
      "requirements",
      "acceptanceCriteria",
      "testScenarios",
      "projectConfig",
    ],
    requiredSteps: [Step.TestCases],
  },
);
