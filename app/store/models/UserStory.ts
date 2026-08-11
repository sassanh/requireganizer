import { Instance } from "mobx-state-tree";

import { StructuralFragment } from "store";

import { createStructuralFragmentModel } from "./StructuralFragment";

export const UserStoryModel = createStructuralFragmentModel(
  "UserStory",
  StructuralFragment.UserStory,
);

export type UserStory = Instance<typeof UserStoryModel>;
