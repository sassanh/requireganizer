import { toGenerator } from "mobx-state-tree";

import { generateStructuralFragment } from "actions/ai/generate-structural-fragment";
import { Step, StructuralFragment } from "store";

import { generator, handleFunctionCall } from "./utilities";

export default generator(
  function* generateUserStories(self) {
    self.resetValidationErrors();

    const { functionCall } = yield* toGenerator(
      generateStructuralFragment({
        state: self.json(Step.UserStories),
        structuralFragment: StructuralFragment.UserStory,
      }),
    );

    handleFunctionCall(self, functionCall);

    self.eventTarget.emit("stepUpdate", Step.UserStories);
  },
  { requirements: ["description", "productOverview", "requirements"] },
);
