import { cast, Instance, SnapshotIn, types } from "mobx-state-tree";

import type { ApprovalStatus } from "contract-domain";
import {
  StructuralFragment,
} from "store/constants";

import { createStructuralFragmentModel } from "./StructuralFragment";

export type PrimaryFeature = Instance<typeof PrimaryFeatureModel>;

export const PrimaryFeatureModel = createStructuralFragmentModel(
  "PrimaryFeature",
  StructuralFragment.PrimaryFeature,
);

export type TargetUser = Instance<typeof TargetUserModel>;

export const TargetUserModel = createStructuralFragmentModel(
  "TargetUser",
  StructuralFragment.TargetUser,
);

export type ProductOverview = Instance<typeof ProductOverviewModel>;

export const ProductOverviewModel = types
  .model("ProductOverview", {
    name: types.maybeNull(types.string),
    purpose: types.maybeNull(types.string),
    nameApproval: types.optional(
      types.enumeration<ApprovalStatus>(["draft", "approved"]),
      "draft",
    ),
    purposeApproval: types.optional(
      types.enumeration<ApprovalStatus>(["draft", "approved"]),
      "draft",
    ),
    primaryFeatures: types.array(PrimaryFeatureModel),
    targetUsers: types.array(TargetUserModel),
  })
  .preProcessSnapshot((snapshot) => {
    if (snapshot == null || typeof snapshot !== "object") return snapshot;
    const record = snapshot as Record<string, unknown>;
    const {
      nameQuality: _nameQuality,
      purposeQuality: _purposeQuality,
      nameIssues: _nameIssues,
      purposeIssues: _purposeIssues,
      ...rest
    } = record;
    return rest as typeof snapshot;
  })
  .actions((self) => ({
    uncheckName() {
      self.nameApproval = "draft";
    },
    uncheckPurpose() {
      self.purposeApproval = "draft";
    },
    approveName() {
      self.nameApproval = "approved";
    },
    approvePurpose() {
      self.purposeApproval = "approved";
    },
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
  }))
  .views((self) => ({
    get isEmpty() {
      return (
        self.name === null &&
        self.purpose === null &&
        self.primaryFeatures.length === 0 &&
        self.targetUsers.length === 0
      );
    },
    get isComplete() {
      return (
        (self.name?.trim().length ?? 0) > 0 &&
        (self.purpose?.trim().length ?? 0) > 0 &&
        self.primaryFeatures.length > 0 &&
        self.primaryFeatures.every(({ content }) => content.trim().length > 0) &&
        self.targetUsers.length > 0 &&
        self.targetUsers.every(({ content }) => content.trim().length > 0)
      );
    },
  }));
