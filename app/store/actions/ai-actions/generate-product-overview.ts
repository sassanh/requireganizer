import { toGenerator } from "mobx-state-tree";

import { WorkflowStage } from "store";

import { generator } from "./utilities";

export default generator(
  function* (self, seed?: string) {
    const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
    const trimmedSeed = seed?.trim();
    if (trimmedSeed != null && trimmedSeed.length > 0) {
      self.setOverviewSeed({ seed: trimmedSeed });
    }
    yield* toGenerator(runAgentCommand(self, "generate the product overview", {
      kind: "generate",
      stage: WorkflowStage.ProductOverview,
      ...(trimmedSeed != null && trimmedSeed.length > 0 ? { seed: trimmedSeed } : {}),
    }));
    self.eventTarget.emit("stepUpdate", WorkflowStage.ProductOverview);
  },
  {
    operation: "generate the product overview",
  },
);
