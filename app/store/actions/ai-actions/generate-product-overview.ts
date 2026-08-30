import { toGenerator } from "mobx-state-tree";

import { WorkflowStage } from "store";

import { generator } from "./utilities";

export default generator(
  function* (self) {
    const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
    yield* toGenerator(runAgentCommand(self, "generate the product overview", {
      kind: "generate",
      stage: WorkflowStage.ProductOverview,
    }));
    self.eventTarget.emit("stepUpdate", WorkflowStage.ProductOverview);
  },
  {
    operation: "generate the product overview",
    requirements: ["description"],
    requiredSteps: [WorkflowStage.Description],
  },
);
