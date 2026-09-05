import { toGenerator } from "mobx-state-tree";

import {
  OVERVIEW_NAME_QUALITY_ID,
  OVERVIEW_PURPOSE_QUALITY_ID,
  WorkflowStage,
} from "store/constants";

import { generator } from "./utilities";

export default generator(
  function* (
    self,
    { field, comment }: { field: "name" | "purpose"; comment: string },
  ) {
    const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
    yield* toGenerator(runAgentCommand(self, "apply the requested change", {
      kind: "comment",
      id: field === "name" ? OVERVIEW_NAME_QUALITY_ID : OVERVIEW_PURPOSE_QUALITY_ID,
      comment,
    }));
  },
  {
    operation: "apply the requested change",
    requirements: [],
    targetStep: WorkflowStage.ProductOverview,
  },
);
