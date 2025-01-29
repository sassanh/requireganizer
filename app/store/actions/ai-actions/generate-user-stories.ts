import { toGenerator } from "mobx-state-tree";

import { Iteration, StructuralFragment } from "store";

import { generator, handleFunctionCall } from "./utilities";
import { generateStructuralFragment } from "actions/ai/generate-structural-fragment";

export default generator(
  function* generateUserStories(self) {
    self.resetValidationErrors();

    const { functionCall } = yield* toGenerator(
      generateStructuralFragment({
        state: self.json(Iteration.userStories),
        structuralFragment: StructuralFragment.userStory,
      }),
    );

    handleFunctionCall(self, functionCall);

    self.eventTarget.emit("iterationUpdate", Iteration.userStories);
  },
  { requirements: ["description", "productOverview", "requirements"] },
);
