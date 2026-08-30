import { toGenerator } from "mobx-state-tree";

import { WorkflowStage } from "store";

import { generator } from "./utilities";

export default generator(
  function* generateBoundaryDesign(self) {
    const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
    yield* toGenerator(runAgentCommand(self, "generate boundary design", {
      kind: "generate",
      stage: WorkflowStage.BoundaryDesign,
    }));
    self.eventTarget.emit("stepUpdate", WorkflowStage.BoundaryDesign);
  },
  {
    operation: "generate boundary design",
    requirements: ["requirements", "acceptanceCriteria"],
    requiredSteps: [WorkflowStage.AcceptanceCriteria],
  },
);
