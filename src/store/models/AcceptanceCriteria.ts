import { Instance, types } from "mobx-state-tree";

import { StructuralFragmentModel } from "./StructuralFragment";

export const AcceptanceCriteriaModel = types
  .compose(
    StructuralFragmentModel,
    types.model({
      type: types.optional(
        types.literal("AcceptanceCriteria"),
        "AcceptanceCriteria"
      ),
    })
  )
  .named("AcceptanceCriteria");

export type AcceptanceCriteria = Instance<typeof AcceptanceCriteriaModel>;
