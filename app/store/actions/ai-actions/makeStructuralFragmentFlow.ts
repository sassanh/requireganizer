import { SnapshotOrInstance, toGenerator } from "mobx-state-tree";

import { generateStructuralFragment } from "actions/ai/generate-structural-fragment";
import { Step, StructuralFragment } from "store";
import { FlatStore } from "store/store";

import { generator, handleFunctionCalls } from "./utilities";

export function makeStructuralFragmentFlow<
  Requirements extends string & keyof SnapshotOrInstance<FlatStore>,
>({
  step,
  structuralFragment,
  requirements,
}: {
  step: Step;
  structuralFragment: StructuralFragment;
  requirements: Requirements[];
}) {
  return generator<[], Requirements>(
    function* generateStructuralFragmentFlow(self) {
      const store = self as FlatStore;
      store.resetValidationErrors();

      const { functionCalls } = yield* toGenerator(
        generateStructuralFragment({
          state: store.json(step),
          structuralFragment,
        }),
      );

      handleFunctionCalls(store, functionCalls);
      store.eventTarget.emit("stepUpdate", step);
    },
    { requirements },
  );
}
