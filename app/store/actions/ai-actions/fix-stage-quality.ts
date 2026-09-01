import { toGenerator } from "mobx-state-tree";

import { qualityContractForStage } from "ai-harness/workflow";
import { UserFacingError } from "lib/errors";
import { Quality, WORKFLOW_STAGE_LABELS, WorkflowStage } from "store";

import { generator } from "./utilities";

export default generator(
  function* (self, step: WorkflowStage) {
    if (qualityContractForStage(step) == null) {
      throw new UserFacingError(`${WORKFLOW_STAGE_LABELS[step]} has no writing-quality contract.`);
    }
    if (self.stageQuality(step) !== Quality.Bad) {
      throw new UserFacingError(`Nothing to fix in ${WORKFLOW_STAGE_LABELS[step]}.`);
    }
    const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
    yield* toGenerator(runAgentCommand(self, `fix ${WORKFLOW_STAGE_LABELS[step]} quality`, {
      kind: "fix",
      stage: step,
    }));
  },
  {
    operation: "fix writing quality",
  },
);
