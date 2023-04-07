import { Instance, types } from "mobx-state-tree";
import { StructrualFragment } from "store/utilities";

import { StructuralFragmentModel } from "./StructuralFragment";

export type AcceptanceCriteria = Instance<typeof AcceptanceCriteriaModel>;

export const AcceptanceCriteriaModel = types
  .compose(
    StructuralFragmentModel,
    types.model({
      type: types.optional(
        types.literal(StructrualFragment.acceptanceCriteria),
        StructrualFragment.acceptanceCriteria
      ),
    })
  )
  .named("AcceptanceCriteria");
