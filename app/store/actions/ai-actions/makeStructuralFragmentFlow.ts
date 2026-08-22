import { SnapshotOrInstance, toGenerator } from "mobx-state-tree";

import { Step, StructuralFragment } from "store";
import { FlatStore } from "store/store";

import { generator } from "./utilities";

export function makeStructuralFragmentFlow<
  Requirements extends string & keyof SnapshotOrInstance<FlatStore>,
>({
  step,
  structuralFragment,
  requirements,
  requiredSteps,
}: {
  step: Step;
  structuralFragment: StructuralFragment;
  requirements: Requirements[];
  requiredSteps: readonly Step[];
}) {
  return generator(
    function* generateStructuralFragmentFlow(self) {
    const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
      const store = self as FlatStore;
      yield* toGenerator(runAgentCommand(store, `generate ${structuralFragment.replaceAll("_", " ")} items`, {
        kind: "generate",
        stage: step as Exclude<Step, Step.Code>,
      }));
      store.eventTarget.emit("stepUpdate", step);
    },
    {
      operation: `generate ${structuralFragment.replaceAll("_", " ")} items`,
      requirements,
      requiredSteps,
    },
  );
}
