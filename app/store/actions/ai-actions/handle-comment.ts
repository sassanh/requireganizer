import { toGenerator } from "mobx-state-tree";

import { handleComment } from "actions/ai/handle-comment";
import { STEP_BY_STRUCTURAL_FRAGMENT } from "store";
import { StructuralFragment } from "store/models";

import { generator, handleFunctionCall } from "./utilities";

export default generator(
  function* (
    self,
    { fragment, comment }: { fragment: StructuralFragment; comment: string },
  ) {
    self.resetValidationErrors();

    const step = STEP_BY_STRUCTURAL_FRAGMENT[fragment.type];

    const { functionCall } = yield* toGenerator(
      handleComment({
        state: self.json(step),
        structuralFragment: fragment.type,
        id: fragment.id,
        comment,
      }),
    );

    handleFunctionCall(self, functionCall);
  },
  {
    requirements: [],
  },
);
