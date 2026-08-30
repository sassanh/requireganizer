import { toGenerator } from "mobx-state-tree";

import { WORKFLOW_STAGE_BY_STRUCTURAL_FRAGMENT } from "store";
import { StructuralFragment } from "store/models";

import { generator } from "./utilities";

export default generator(
  function* (
    self,
    { fragment, comment }: { fragment: StructuralFragment; comment: string },
  ) {
    const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
    yield* toGenerator(runAgentCommand(self, "apply the requested change", {
      kind: "comment",
      fragment: fragment.type,
      id: fragment.id,
      comment,
    }));
  },
  {
    operation: "apply the requested change",
    requirements: [],
  },
);
