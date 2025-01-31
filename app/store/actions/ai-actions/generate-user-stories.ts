import { toGenerator } from "mobx-state-tree";

import { generateStructuralFragment } from "actions/ai/generate-structural-fragment";
import { Iteration, StructuralFragment } from "store";

import { generator, handleFunctionCall } from "./utilities";

export default generator(
  function* generateUserStories(self) {
    self.resetValidationErrors();

    const { functionCall } = yield* toGenerator(
      generateStructuralFragment({
        state: self.json(Iteration.userStories),
        structuralFragment: StructuralFragment.UserStory,
      }),
    );

    handleFunctionCall(self, functionCall);

    self.eventTarget.emit("iterationUpdate", Iteration.userStories);
  },
  { requirements: ["description", "productOverview", "requirements"] },
);
