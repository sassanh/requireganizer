import { toGenerator } from "mobx-state-tree";

import { WorkflowStage } from "store/constants";

import { generator } from "./utilities";

/** Ask the reviewer model for verdicts on a stage's units that await one. */
export default generator(
  function* (self, step: WorkflowStage) {
    const { reviewStageUnits } = yield* toGenerator(import("ai-agent/reviewer"));
    yield* toGenerator(reviewStageUnits(self, step));
  },
  {
    operation: "review the stage",
    targetStep: (step: WorkflowStage) => step,
    reviewAfter: false,
  },
);
