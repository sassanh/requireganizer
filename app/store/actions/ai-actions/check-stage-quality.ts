import { toGenerator } from "mobx-state-tree";

import { qualityContractForStage } from "ai-harness/workflow";
import { UserFacingError } from "lib/errors";
import { WORKFLOW_STAGE_LABELS, WorkflowStage } from "store";

import { generator } from "./utilities";

export default generator(
  function* (self, step: WorkflowStage) {
    if (qualityContractForStage(step) == null) {
      throw new UserFacingError(`${WORKFLOW_STAGE_LABELS[step]} has no writing-quality contract.`);
    }
    if (!self.hasStepArtifacts(step)) {
      throw new UserFacingError(`Nothing to check in ${WORKFLOW_STAGE_LABELS[step]}.`);
    }
    const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
    yield* toGenerator(runAgentCommand(self, `check ${WORKFLOW_STAGE_LABELS[step]} quality`, {
      kind: "check",
      stage: step,
    }));
  },
  {
    operation: "check writing quality",
  },
);
