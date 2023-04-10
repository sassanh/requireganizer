import { Instance, types } from "mobx-state-tree";

import { uuid } from "utilities";

export type StructuralFragment = Instance<typeof StructuralFragmentModel>;

export const StructuralFragmentModel = types
  .model({
    id: types.optional(types.identifier, uuid),
    content: types.string,
  })
  .actions((self) => ({
    updateContent(newContent: string) {
      self.content = newContent;
    },
  }))
  .named("StructuralFragment");
