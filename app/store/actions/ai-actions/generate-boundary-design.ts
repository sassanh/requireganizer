import { toGenerator } from "mobx-state-tree";

import { Step } from "store";

import { generator } from "./utilities";

export default generator(
  function* generateBoundaryDesign(self) {
    const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
    yield* toGenerator(runAgentCommand(self, "generate boundary design", {
      kind: "generate",
      stage: Step.BoundaryDesign,
    }));
    self.eventTarget.emit("stepUpdate", Step.BoundaryDesign);
  },
  {
    operation: "generate boundary design",
    requirements: ["requirements", "acceptanceCriteria"],
    requiredSteps: [Step.AcceptanceCriteria],
  },
);
