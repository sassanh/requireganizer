import { cast, Instance, SnapshotIn, types } from "mobx-state-tree";

import {
  Framework,
  ProgrammingLanguage,
  StructuralFragment,
} from "store/constants";

import { StructuralFragmentModel } from "./StructuralFragment";

export type PrimaryFeature = Instance<typeof PrimaryFeatureModel>;

export const PrimaryFeatureModel = types
  .compose(
    StructuralFragmentModel,
    types.model({
      type: types.optional(
        types.literal(StructuralFragment.PrimaryFeature),
        StructuralFragment.PrimaryFeature,
      ),
    }),
  )
  .named("PrimaryFeature");

export type TargetUser = Instance<typeof TargetUserModel>;

export const TargetUserModel = types
  .compose(
    StructuralFragmentModel,
    types.model({
      type: types.optional(
        types.literal(StructuralFragment.TargetUser),
        StructuralFragment.TargetUser,
      ),
    }),
  )
  .named("TargetUser");

export type ProductOverview = Instance<typeof ProductOverviewModel>;

export const ProductOverviewModel = types
  .model("ProductOverview", {
    name: types.maybeNull(types.string),
    purpose: types.maybeNull(types.string),
    primaryFeatures: types.array(PrimaryFeatureModel),
    targetUsers: types.array(TargetUserModel),
    framework: types.maybeNull(types.enumeration(Object.values(Framework))),
    programmingLanguage: types.maybeNull(
      types.enumeration(Object.values(ProgrammingLanguage)),
    ),
  })
  .actions((self) => ({
    setPrimaryFeatures({
      primaryFeatures,
    }: {
      primaryFeatures: SnapshotIn<PrimaryFeature>[];
    }) {
      self.primaryFeatures.clear();
      self.primaryFeatures = cast(primaryFeatures);
    },
    setTargetUsers({ targetUsers }: { targetUsers: SnapshotIn<TargetUser>[] }) {
      self.targetUsers.clear();
      self.targetUsers = cast(targetUsers);
    },
    addPrimaryFeature() {
      self.primaryFeatures.push(
        PrimaryFeatureModel.create({ content: "New Primary Feature" }),
      );
    },
    addTargetUser() {
      self.targetUsers.push(
        TargetUserModel.create({ content: "New Target User" }),
      );
    },
    removePrimaryFeature({
      fragment: primaryFeature,
    }: {
      fragment: PrimaryFeature;
    }) {
      self.primaryFeatures.remove(primaryFeature);
    },
    removeTargetUser({ fragment: targetUser }: { fragment: TargetUser }) {
      self.targetUsers.remove(targetUser);
    },
  }));
