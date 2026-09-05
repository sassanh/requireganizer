import { toGenerator } from "mobx-state-tree";

import { WorkflowStage } from "store";

import { generator } from "./utilities";

export default generator(
  function* (self, seed?: string, hint?: string) {
    const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
    const trimmedSeed = seed?.trim();
    if (trimmedSeed != null && trimmedSeed.length > 0) {
      self.setOverviewSeed({ seed: trimmedSeed });
    }
    const trimmedHint = hint?.trim();
    yield* toGenerator(runAgentCommand(self, "generate the product overview", {
      kind: "generate",
      stage: WorkflowStage.ProductOverview,
      ...(trimmedSeed != null && trimmedSeed.length > 0 ? { seed: trimmedSeed } : {}),
      ...(trimmedHint != null && trimmedHint.length > 0 ? { hint: trimmedHint } : {}),
    }));
    self.eventTarget.emit("stepUpdate", WorkflowStage.ProductOverview);
  },
  {
    operation: "generate the product overview",
    targetStep: WorkflowStage.ProductOverview,
  },
);
