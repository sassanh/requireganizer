import { toGenerator } from "mobx-state-tree";

import {
  GENERATE_STRUCTURAL_FRAGMENT_ENDPOINT,
  GenerateStructuralFragmentRequestBody,
  ResponseBody,
} from "api";
import { Iteration, StructuralFragment } from "store";

import { generator, handleFunctionCall } from "./utilities";

export default generator(
  function* generateRequirements(self) {
    self.resetValidationErrors();

    const requestBody: GenerateStructuralFragmentRequestBody = {
      state: self.json(Iteration.requirements),
      structuralFragment: StructuralFragment.requirement,
    };

    const response: Response = yield* toGenerator(
      fetch(GENERATE_STRUCTURAL_FRAGMENT_ENDPOINT, {
        method: "POST",
        body: JSON.stringify(requestBody),
      })
    );

    const { functionCall } = (yield* toGenerator(
      response.json()
    )) as ResponseBody;

    handleFunctionCall(self, functionCall);

    self.eventTarget.emit("iterationUpdate", Iteration.requirements);
  },
  { requirements: ["description", "productOverview", "userStories"] }
);
