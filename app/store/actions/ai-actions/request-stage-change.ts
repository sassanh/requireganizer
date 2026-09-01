import { toGenerator } from "mobx-state-tree";

import type { CommandStage } from "ai-agent/command";
import { UserFacingError } from "lib/errors";
import { WORKFLOW_STAGE_LABELS, WorkflowStage } from "store";

import { generator } from "./utilities";

export default generator(
  function* (self, step: WorkflowStage, comment: string) {
    if (step === WorkflowStage.Code) return;
    if (self.stageIsLocked(step)) {
      const blocker = self.firstPendingPredecessor(step) ?? step;
      throw new UserFacingError(
        `Complete ${WORKFLOW_STAGE_LABELS[blocker]} before requesting a change.`,
      );
    }
    const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
    yield* toGenerator(runAgentCommand(self, `revise ${WORKFLOW_STAGE_LABELS[step]}`, {
      kind: "revise",
      stage: step as CommandStage,
      comment,
    }));
  },
  {
    operation: "apply the requested change",
  },
);
