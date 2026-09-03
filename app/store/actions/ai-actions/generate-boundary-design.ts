import { toGenerator } from "mobx-state-tree";

import { WorkflowStage } from "store";

import { generator } from "./utilities";

export default generator(
  function* generateBoundaryDesign(self, hint?: string) {
    const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
    const trimmedHint = hint?.trim();
    yield* toGenerator(runAgentCommand(self, "generate boundary design", {
      kind: "generate",
      stage: WorkflowStage.BoundaryDesign,
      ...(trimmedHint != null && trimmedHint.length > 0 ? { hint: trimmedHint } : {}),
    }));
    self.eventTarget.emit("stepUpdate", WorkflowStage.BoundaryDesign);
  },
  {
    operation: "generate boundary design",
    requirements: ["requirements", "acceptanceCriteria"],
    requiredSteps: [WorkflowStage.AcceptanceCriteria],
  },
);
