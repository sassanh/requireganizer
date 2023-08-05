import { toGenerator } from "mobx-state-tree";

import {
  GENERATE_STRUCTURAL_FRAGMENT_ENDPOINT,
  GenerateStructuralFragmentRequestBody,
  ResponseBody,
} from "api";
import { Iteration, StructuralFragment } from "store";

import { generator, handleFunctionCall } from "./utilities";

export default generator(
  function* generateAcceptanceCriteria(self) {
    self.resetValidationErrors();

    const requestBody: GenerateStructuralFragmentRequestBody = {
      state: self.json(Iteration.acceptanceCriteria),
      structuralFragment: StructuralFragment.acceptanceCriteria,
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

    self.eventTarget.emit("iterationUpdate", Iteration.acceptanceCriteria);
  },
  {
    requirements: [
      "description",
      "productOverview",
      "userStories",
      "requirements",
    ],
  }
);
