import { toGenerator } from "mobx-state-tree";

import type { CommandStage } from "ai-agent/command";
import { WorkflowStage } from "store";

import { generator } from "./utilities";

export default generator(
  function* (self, step: WorkflowStage, comment: string) {
    if (step === WorkflowStage.Code) return;
    const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
    yield* toGenerator(runAgentCommand(self, `revise ${self.stageLabel(step)}`, {
      kind: "revise",
      stage: step as CommandStage,
      comment,
    }));
  },
  {
    operation: "apply the requested change",
    targetStep: (step: WorkflowStage, _comment: string) => step,
  },
);
