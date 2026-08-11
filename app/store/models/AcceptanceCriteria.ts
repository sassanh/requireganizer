import { Instance } from "mobx-state-tree";

import { StructuralFragment } from "store";

import { createStructuralFragmentModel } from "./StructuralFragment";

export const AcceptanceCriteriaModel = createStructuralFragmentModel(
  "AcceptanceCriteria",
  StructuralFragment.AcceptanceCriteria,
);

export type AcceptanceCriteria = Instance<typeof AcceptanceCriteriaModel>;
