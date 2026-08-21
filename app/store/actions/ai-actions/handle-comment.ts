import { toGenerator } from "mobx-state-tree";

import { STEP_BY_STRUCTURAL_FRAGMENT } from "store";
import { StructuralFragment } from "store/models";

import {
  applyFragmentRevisionProposal,
  consumeHarnessResult,
  generator,
  runAiOperation,
} from "./utilities";

export default generator(
  function* (
    self,
    { fragment, comment }: { fragment: StructuralFragment; comment: string },
  ) {
    const step = STEP_BY_STRUCTURAL_FRAGMENT[fragment.type];

    const result = yield* toGenerator(runAiOperation(self, "handle-comment", {
      state: self.json(step),
      structuralFragment: fragment.type,
      id: fragment.id,
      comment,
    }));

    const proposal = consumeHarnessResult(self, result);
    if (proposal == null) return;
    applyFragmentRevisionProposal(self, proposal);
  },
  {
    operation: "apply the requested change",
    requirements: [],
  },
);
