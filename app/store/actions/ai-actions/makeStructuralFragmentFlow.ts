import { SnapshotOrInstance, toGenerator } from "mobx-state-tree";

import { generateStructuralFragment } from "actions/ai/generate-structural-fragment";
import { Step, StructuralFragment } from "store";
import { FlatStore } from "store/store";

import {
  applyArtifactListProposal,
  consumeHarnessResult,
  generator,
} from "./utilities";

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
      const store = self as FlatStore;
      const result = yield* toGenerator(
        generateStructuralFragment({
          state: store.json(step),
          structuralFragment,
        }),
      );

      const proposal = consumeHarnessResult(store, result);
      if (proposal == null) return;
      applyArtifactListProposal(store, proposal);
      store.eventTarget.emit("stepUpdate", step);
    },
    {
      operation: `generate ${structuralFragment.replaceAll("_", " ")} items`,
      requirements,
      requiredSteps,
    },
  );
}
