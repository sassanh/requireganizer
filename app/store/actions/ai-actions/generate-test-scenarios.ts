import { toGenerator } from "mobx-state-tree";

import { WorkflowStage } from "store";

import { generator } from "./utilities";

export default generator(
  function* generateTestScenarios(self, hint?: string) {
    const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
    const trimmedHint = hint?.trim();
    yield* toGenerator(runAgentCommand(self, "generate test scenarios", {
      kind: "generate",
      stage: WorkflowStage.TestScenarios,
      ...(trimmedHint != null && trimmedHint.length > 0 ? { hint: trimmedHint } : {}),
    }));
    self.eventTarget.emit("stepUpdate", WorkflowStage.TestScenarios);
  },
  {
    operation: "generate test scenarios",
    requirements: ["boundaryDesign", "contractSuite"],
    targetStep: WorkflowStage.TestScenarios,
  },
);
