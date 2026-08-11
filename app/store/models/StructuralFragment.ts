import { cast, getParent, Instance, types } from "mobx-state-tree";

import { uuid } from "utilities";

import {
  FRAGMENT_CODES,
  Priority,
  StructuralFragment as StructuralFragmentName,
} from "../constants";

export type Reference = Instance<typeof ReferenceModel>;

export interface ReferenceData {
  id: string;
  type: StructuralFragmentName;
}

export interface StructuralFragmentUpdate {
  content?: string;
  priority?: Priority;
  references?: ReferenceData[];
  dependencies?: string[];
}

export const ReferenceModel = types.model({
  id: types.string,
  type: types.enumeration(Object.values(StructuralFragmentName)),
});

export type StructuralFragment = Instance<typeof StructuralFragmentModel>;

const HalfStructuralFragmentModel = types
  .model({
    id: types.optional(types.identifier, uuid),
    type: types.optional(
      types.enumeration(Object.values(StructuralFragmentName)),
      // Theoretically this value should never be used as `StructuralFragmentModel` is just an abstract type
      StructuralFragmentName.UserStory,
    ),
    content: types.string,
    priority: types.maybeNull(types.enumeration(Object.values(Priority))),
    references: types.array(ReferenceModel),
    dependencies: types.array(types.string),
  })
  .actions((self) => ({
    setContent(newContent: string) {
      self.content = newContent;
    },
    setPriority(newPriority: Priority) {
      self.priority = newPriority;
    },
    setReferences(newReferences: ReferenceData[]) {
      self.references = cast(newReferences);
    },
    setDependencies(newDependencies: string[]) {
      self.dependencies = cast(newDependencies);
    },
    setData({
      content,
      priority,
      references,
      dependencies,
    }: StructuralFragmentUpdate) {
      if (content !== undefined) self.content = content;
      if (priority !== undefined) self.priority = priority;
      if (references !== undefined)
        self.references = cast(
          references.map((reference) => ReferenceModel.create(reference)),
        );
      if (dependencies !== undefined) self.dependencies = cast(dependencies);
    },
  }));

export const StructuralFragmentModel = HalfStructuralFragmentModel.views(
  (self) => ({
    getIndex() {
      const StructuralFragmentArrayModel = types.array(
        HalfStructuralFragmentModel,
      );
      const parentArray = getParent<
        Instance<typeof StructuralFragmentArrayModel>
      >(self, 1);
      return parentArray.indexOf(self) + 1;
    },
  }),
)
  .views((self) => ({
    getCode() {
      return `${FRAGMENT_CODES[self.type]}-${self.getIndex()}`;
    },
  }))
  .named("StructuralFragment");

export function createStructuralFragmentModel<
  Name extends string,
  Type extends StructuralFragmentName,
>(name: Name, type: Type) {
  return types
    .compose(
      StructuralFragmentModel,
      types.model({
        type: types.optional(types.literal(type), type),
      }),
    )
    .named(name);
}
