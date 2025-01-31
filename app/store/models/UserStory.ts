import { Instance, types } from "mobx-state-tree";

import { StructuralFragment } from "store";

import { StructuralFragmentModel } from "./StructuralFragment";

export type UserStory = Instance<typeof UserStoryModel>;

export const UserStoryModel = types
  .compose(
    StructuralFragmentModel,
    types.model({
      type: types.optional(
        types.literal(StructuralFragment.UserStory),
        StructuralFragment.UserStory,
      ),
    }),
  )
  .named("UserStory");
