import { cast, getParent, Instance, isAlive, types } from "mobx-state-tree";

import type { ApprovalStatus } from "contract-domain";
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

export function referencesEqual(
  next: ReadonlyArray<{ id: string; type: string }>,
  current: ReadonlyArray<{ id: string; type: string }>,
): boolean {
  return (
    next.length === current.length &&
    next.every(
      (reference, index) =>
        reference.id === current[index].id &&
        reference.type === current[index].type,
    )
  );
}

export function dependenciesEqual(
  next: ReadonlyArray<string>,
  current: ReadonlyArray<string>,
): boolean {
  return (
    next.length === current.length &&
    next.every((dependency, index) => dependency === current[index])
  );
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
    approval: types.optional(
      types.enumeration<ApprovalStatus>(["draft", "approved"]),
      "draft",
    ),
    lastSignedContent: types.optional(types.maybeNull(types.string), null),
    pendingRemoval: types.optional(types.boolean, false),
  })
  .preProcessSnapshot((snapshot) => {
    if (snapshot == null || typeof snapshot !== "object") return snapshot;
    const record = snapshot as Record<string, unknown>;
    const { quality: _quality, qualityIssues: _qualityIssues, ...rest } = record;
    return rest as typeof snapshot;
  })
  .actions((self) => ({
    dropApproval() {
      if (self.approval === "draft") return;
      self.lastSignedContent = self.content;
      self.approval = "draft";
    },
    approve() {
      self.approval = "approved";
      self.lastSignedContent = null;
      self.pendingRemoval = false;
    },
    clearPendingRemoval() {
      self.pendingRemoval = false;
    },
    // An edit landing back on the last approved text restores approval:
    // there is nothing left to review.
    reapproveIfMatchesSigned() {
      if (
        !self.pendingRemoval &&
        self.lastSignedContent != null &&
        self.content === self.lastSignedContent
      ) {
        self.approval = "approved";
        self.lastSignedContent = null;
      }
    },
  }))
  .actions((self) => ({
    markPendingRemoval() {
      self.dropApproval();
      self.pendingRemoval = true;
    },
    setContent(newContent: string) {
      if (self.content === newContent) return;
      self.dropApproval();
      self.content = newContent;
      self.reapproveIfMatchesSigned();
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
      if (content !== undefined && content !== self.content) {
        self.dropApproval();
        self.content = content;
      }
      if (priority !== undefined) self.priority = priority;
      if (references !== undefined)
        self.references = cast(
          references.map((reference) => ReferenceModel.create(reference)),
        );
      if (dependencies !== undefined) self.dependencies = cast(dependencies);
      self.reapproveIfMatchesSigned();
    },
  }));

export const StructuralFragmentModel = HalfStructuralFragmentModel.views(
  (self) => ({
    getIndex() {
      // Undo/redo applies snapshots synchronously, which can destroy this
      // node while a render still holds it. Keep the view dead-safe: the
      // next render replaces the node with a live one.
      if (!isAlive(self)) return 0;
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
      if (!isAlive(self)) return "";
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
