import { toGenerator } from "mobx-state-tree";

import { Step } from "store";

import { generator } from "./utilities";

export default generator(
  function* (self) {
    const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
    yield* toGenerator(runAgentCommand(self, "generate the product overview", {
      kind: "generate",
      stage: Step.ProductOverview,
    }));
    self.eventTarget.emit("stepUpdate", Step.ProductOverview);
  },
  {
    operation: "generate the product overview",
    requirements: ["description"],
    requiredSteps: [Step.Description],
  },
);
