import { Instance, types } from "mobx-state-tree";

import { uuid } from "utilities";

import { StructuralFragment as StructuralFragmentName } from "../constants";

export type Reference = Instance<typeof ReferenceModel>;

export const ReferenceModel = types.model({
  id: types.identifier,
  type: types.enumeration(Object.values(StructuralFragmentName)),
});

export type StructuralFragment = Instance<typeof StructuralFragmentModel>;

export const StructuralFragmentModel = types
  .model({
    id: types.optional(types.identifier, uuid),
    content: types.string,
    type: types.optional(
      types.enumeration(Object.values(StructuralFragmentName)),
      // Theoretically this value should never be used as `StructuralFragmentModel` is just an abstract type
      StructuralFragmentName.UserStory,
    ),
    references: types.array(ReferenceModel),
  })
  .actions((self) => ({
    updateContent(newContent: string) {
      self.content = newContent;
    },
  }))
  .named("StructuralFragment");
