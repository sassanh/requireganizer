import { Instance, types } from "mobx-state-tree";

import { StructuralFragment } from "store";

import { StructuralFragmentModel } from "./StructuralFragment";

export type AcceptanceCriteria = Instance<typeof AcceptanceCriteriaModel>;

export const AcceptanceCriteriaModel = types
  .compose(
    StructuralFragmentModel,
    types.model({
      type: types.optional(
        types.literal(StructuralFragment.AcceptanceCriteria),
        StructuralFragment.AcceptanceCriteria,
      ),
    }),
  )
  .named("AcceptanceCriteria");
