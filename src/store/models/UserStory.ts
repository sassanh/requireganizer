import { Instance, types } from "mobx-state-tree";
import { StructrualFragment } from "store";

import { StructuralFragmentModel } from "./StructuralFragment";

export type UserStory = Instance<typeof UserStoryModel>;

export const UserStoryModel = types
  .compose(
    StructuralFragmentModel,
    types.model({
      type: types.optional(
        types.literal(StructrualFragment.userStory),
        StructrualFragment.userStory
      ),
    })
  )
  .named("UserStory");
