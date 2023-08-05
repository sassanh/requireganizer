import { toGenerator } from "mobx-state-tree";

import {
  HANDLE_COMMENT_ENDPOINT,
  HandleCommentRequestBody,
  ResponseBody,
} from "api";
import { ITERATION_BY_STRUCTURAL_FRAGMENT } from "store";
import { StructuralFragment } from "store/models";

import { generator, handleFunctionCall } from "./utilities";

export default generator(
  function* handleComment(self, fragment: StructuralFragment, comment: string) {
    self.resetValidationErrors();

    const iteration = ITERATION_BY_STRUCTURAL_FRAGMENT[fragment.type];

    const requestBody: HandleCommentRequestBody = {
      state: self.json(iteration),
      structuralFragment: fragment.type,
      id: fragment.id,
      comment,
    };

    const response: Response = yield* toGenerator(
      fetch(HANDLE_COMMENT_ENDPOINT, {
        method: "POST",
        body: JSON.stringify(requestBody),
      })
    );

    const { functionCall } = (yield* toGenerator(
      response.json()
    )) as ResponseBody;

    handleFunctionCall(self, functionCall);
  },
  {
    requirements: [],
  }
);
