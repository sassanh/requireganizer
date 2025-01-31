"use client";

import EventEmitter from "events";

import { IMSTArray, Instance, SnapshotIn, cast, types } from "mobx-state-tree";
import { createContext, useContext } from "react";

import {
  export as export_,
  generateAcceptanceCriteria,
  generateProductOverview,
  generateRequirements,
  generateTestCases,
  generateTestScenarios,
  generateUserStories,
  handleComment,
  import as import_,
} from "./actions";
import {
  Framework,
  Step,
  LAST_STEP,
  PROGRAMMING_LANGUAGE_BY_FRAMEWORK,
  ProgrammingLanguage,
  StructuralFragment as StructuralFragmentName,
  isBefore,
  Priority,
  STEP_BY_STRUCTURAL_FRAGMENT,
} from "./constants";
import {
  AcceptanceCriteria,
  AcceptanceCriteriaModel,
  Requirement,
  RequirementModel,
  StructuralFragment,
  StructuralFragmentModel,
  TestCaseModel,
  TestScenario,
  TestScenarioModel,
  UserStory,
  UserStoryModel,
} from "./models";
import {
  PrimaryFeature,
  PrimaryFeatureModel,
  ProductOverview,
  ProductOverviewModel,
  TargetUser,
  TargetUserModel,
} from "./models/ProductOverview";
import { withSelf } from "./utilities";

class StoreEventEmitter extends EventEmitter {
  emitStepUpdate(step: Step): void {
    this.emit("stepUpdate", step);
  }
}

interface StoreEvents {
  stepUpdate: (step: Step) => void;
}

declare interface StoreEventEmitter {
  once<U extends keyof StoreEvents>(event: U, listener: StoreEvents[U]): this;
  on<U extends keyof StoreEvents>(event: U, listener: StoreEvents[U]): this;
  off<U extends keyof StoreEvents>(event: U, listener: StoreEvents[U]): this;

  emit<U extends keyof StoreEvents>(
    event: U,
    ...args: Parameters<StoreEvents[U]>
  ): boolean;
}

export const FlatStore = types
  .model("Store", {
    isClean: types.optional(types.boolean, true),
    businessCounter: types.optional(types.number, 0),
    description: types.optional(types.string, ""),
    validationErrors: types.maybeNull(types.string),

    productOverview: ProductOverviewModel,
    userStories: types.array(UserStoryModel),
    requirements: types.array(RequirementModel),
    acceptanceCriteria: types.array(AcceptanceCriteriaModel),
    testScenarios: types.array(TestScenarioModel),
    systemMessage: types.maybeNull(types.string),
  })
  .actions((self) => ({
    reset() {
      self.isClean = true;
      self.businessCounter = 0;
      self.description = "";
      self.validationErrors = null;

      self.productOverview = ProductOverviewModel.create({
        name: null,
        purpose: null,
        primaryFeatures: [],
        targetUsers: [],
        programmingLanguage: null,
        framework: null,
      });
      self.userStories = cast([]);
      self.requirements = cast([]);
      self.acceptanceCriteria = cast([]);
      self.testScenarios = cast([]);
    },
    resetValidationErrors() {
      self.validationErrors = null;
    },
    setDescription({ description }: { description: string }) {
      self.description = description;
    },
    setValidationErrors({ validationErrors }: { validationErrors: string }) {
      self.validationErrors = validationErrors;
    },
    setName({ name }: { name: string }) {
      self.productOverview.name = name;
    },
    setPurpose({ purpose }: { purpose: string }) {
      self.productOverview.purpose = purpose;
    },
    setPrimaryFeatures({
      primaryFeatures,
    }: {
      primaryFeatures: SnapshotIn<PrimaryFeature[]>;
    }) {
      self.productOverview.primaryFeatures = cast(primaryFeatures);
    },
    setTargetUsers({ targetUsers }: { targetUsers: SnapshotIn<TargetUser[]> }) {
      self.productOverview.targetUsers = cast(targetUsers);
    },
    setFramework({ framework }: { framework: Framework | null }) {
      self.productOverview.framework = framework;
      if (framework != null)
        self.productOverview.programmingLanguage =
          PROGRAMMING_LANGUAGE_BY_FRAMEWORK[framework].length === 1
            ? PROGRAMMING_LANGUAGE_BY_FRAMEWORK[framework][0]
            : null;
    },
    setProgrammingLanguage({
      programmingLanguage,
    }: {
      programmingLanguage: ProgrammingLanguage;
    }) {
      self.productOverview.programmingLanguage = programmingLanguage;
    },
    initialize(info: {
      name: string;
      purpose: string;
      primaryFeatures: string[];
      targetUsers: string[];
      programmingLanguage: ProgrammingLanguage;
      framework: Framework;
    }) {
      self.productOverview = ProductOverviewModel.create({
        ...info,
        primaryFeatures: info.primaryFeatures.map((content) =>
          PrimaryFeatureModel.create({ content }),
        ),
        targetUsers: info.targetUsers.map((content) =>
          TargetUserModel.create({ content }),
        ),
      });
    },
    setProductOverview(productOverview: ProductOverview) {
      self.productOverview = cast(productOverview);
    },
    setUserStories({ userStories }: { userStories: SnapshotIn<UserStory>[] }) {
      self.isClean = false;
      self.userStories.clear();
      self.userStories = cast(userStories);
    },
    setRequirements({
      requirements,
    }: {
      requirements: SnapshotIn<Requirement>[];
    }) {
      self.isClean = false;
      self.requirements.clear();
      self.requirements = cast(requirements);
    },
    setAcceptanceCriteria({
      acceptanceCriteria,
    }: {
      acceptanceCriteria: SnapshotIn<AcceptanceCriteria>[];
    }) {
      self.isClean = false;
      self.acceptanceCriteria.clear();
      self.acceptanceCriteria = cast(acceptanceCriteria);
    },
    setTestScenarios({
      testScenarios,
    }: {
      testScenarios: SnapshotIn<TestScenario>[];
    }) {
      self.isClean = false;
      self.testScenarios.clear();
      self.testScenarios = cast(testScenarios);
    },
    addUserStory() {
      self.isClean = false;
      self.userStories.push(
        UserStoryModel.create({ content: "New User Story" }),
      );
    },
    addRequirement() {
      self.isClean = false;
      self.requirements.push(
        RequirementModel.create({ content: "New Requirement" }),
      );
    },
    addAcceptanceCriteria() {
      self.isClean = false;
      self.acceptanceCriteria.push(
        AcceptanceCriteriaModel.create({ content: "New Acceptance Criteria" }),
      );
    },
    addTestScenario() {
      self.isClean = false;
      self.testScenarios.push(
        TestScenarioModel.create({ content: "New Test Scenario" }),
      );
    },
    removeUserStory({ fragment: userStory }: { fragment: UserStory }) {
      self.userStories.remove(userStory);
    },
    removeRequirement({ fragment: requirement }: { fragment: Requirement }) {
      self.requirements.remove(requirement);
    },
    removeAcceptanceCriteria({
      fragment: acceptanceCriteria,
    }: {
      fragment: AcceptanceCriteria;
    }) {
      self.acceptanceCriteria.remove(acceptanceCriteria);
    },
    removeTestScenario({ fragment: testScenario }: { fragment: TestScenario }) {
      self.testScenarios.remove(testScenario);
    },
  }))
  .actions((self) => ({
    updateList({
      entityType,
      parentId,
      insertions,
      removals,
      sort,
      modifications,
    }: {
      entityType: StructuralFragmentName;
      parentId: string;
      insertions: {
        content: string;
        priority: Priority;
        references: { id: string; type: StructuralFragmentName }[];
        dependencies: string[];
        index?: number;
      }[];
      removals: string[];
      sort: string[];
      modifications: {
        content: string;
        priority: Priority;
        references: { id: string; type: StructuralFragmentName }[];
        dependencies: string[];
        id: string;
      }[];
    }) {
      var Model_ = {
        [StructuralFragmentName.PrimaryFeature]: PrimaryFeatureModel,
        [StructuralFragmentName.TargetUser]: TargetUserModel,
        [StructuralFragmentName.Requirement]: RequirementModel,
        [StructuralFragmentName.UserStory]: UserStoryModel,
        [StructuralFragmentName.AcceptanceCriteria]: AcceptanceCriteriaModel,
        [StructuralFragmentName.TestScenario]: TestScenarioModel,
        [StructuralFragmentName.TestCase]: TestCaseModel,
        [StructuralFragmentName.TestCode]: null,
      }[entityType];

      if (Model_ == null) {
        console.error("Not implemented yet, model:", entityType);
        return;
      }
      const Model = Model_;

      var list_: IMSTArray<typeof StructuralFragmentModel> | undefined = {
        [StructuralFragmentName.PrimaryFeature]: () =>
          self.productOverview.primaryFeatures,
        [StructuralFragmentName.TargetUser]: () =>
          self.productOverview.targetUsers,
        [StructuralFragmentName.Requirement]: () => self.requirements,
        [StructuralFragmentName.UserStory]: () => self.userStories,
        [StructuralFragmentName.AcceptanceCriteria]: () =>
          self.acceptanceCriteria,
        [StructuralFragmentName.TestScenario]: () => self.testScenarios,
        [StructuralFragmentName.TestCase]: (parentId_: string) =>
          self.testScenarios.find(({ id }) => id === parentId_)?.testCases,
        [StructuralFragmentName.TestCode]: () => undefined,
      }[entityType](parentId);

      if (list_ != null) {
        const list = list_;
        if (sort != null && sort.length > 0) {
          list.sort((a, b) => sort.indexOf(a.id) - sort.indexOf(b.id));
        }
        modifications?.forEach(({ id, ...data }) => {
          const item = list.find(({ id: id_ }) => id === id_);
          item?.setData(data);
        });
        insertions?.forEach(({ index, ...data }) =>
          list.splice(index ?? list.length, 0, Model.create(data)),
        );
        removals?.forEach((id) => {
          const item = list.find(({ id: id_ }) => id === id_);
          if (item != null) list.remove(item);
        });
      }
    },
    communicate({ description }: { description: string }) {
      self.systemMessage = description;
    },
    clearMessage() {
      self.systemMessage = null;
    },
  }))
  .views((self) => ({
    get isBusy() {
      return self.businessCounter > 0;
    },
    get testCases() {
      return self.testScenarios.flatMap(
        (testScenario) => testScenario.testCases,
      );
    },
    data(step: Step = LAST_STEP) {
      return {
        ...(!isBefore(step, Step.Description)
          ? { description: self.description }
          : {}),
        ...(!isBefore(step, Step.ProductOverview)
          ? {
              productOverview: self.productOverview,
            }
          : {}),
        ...(!isBefore(step, Step.Requirements)
          ? { requirements: self.requirements }
          : {}),
        ...(!isBefore(step, Step.UserStories)
          ? { userStories: self.userStories }
          : {}),
        ...(!isBefore(step, Step.AcceptanceCriteria)
          ? { acceptanceCriteria: self.acceptanceCriteria }
          : {}),
        ...(!isBefore(step, Step.TestScenarios)
          ? { testScenarios: self.testScenarios }
          : {}),
      };
    },
    structuralFragmentsCache() {
      function extract(list: StructuralFragment[]) {
        return Object.fromEntries(
          list.map((fragment) => [fragment.id, fragment]),
        );
      }
      return {
        ...extract(self.productOverview.primaryFeatures),
        ...extract(self.productOverview.targetUsers),
        ...extract(self.requirements),
        ...extract(self.userStories),
        ...extract(self.acceptanceCriteria),
        ...extract(self.testScenarios),
        ...(Object.assign(
          {},
          ...self.testScenarios.map((testScenario) =>
            extract(testScenario.testCases),
          ),
        ) as Record<string, StructuralFragment>),
      };
    },
    getCode(id: string) {
      return this.structuralFragmentsCache()[id].getCode();
    },
    getPath(id: string) {
      const fragment = this.structuralFragmentsCache()[id];
      return `?step=${STEP_BY_STRUCTURAL_FRAGMENT[fragment.type]}#${fragment.getCode()}`;
    },
  }))
  .views((self) => ({
    json(step: Step) {
      return JSON.stringify(self.data(step));
    },
  }))
  .views(() => {
    const eventTarget = new StoreEventEmitter();

    return {
      get eventTarget() {
        return eventTarget;
      },
    };
  });

export const Store = FlatStore.actions(
  withSelf({
    handleComment,
    generateProductOverview,
    generateUserStories,
    generateRequirements,
    generateAcceptanceCriteria,
    generateTestScenarios,
    generateTestCases,
  }),
).actions(withSelf({ import: import_, export: export_ }));

export type FlatStore = Instance<typeof FlatStore>;
export type Store = Instance<typeof Store>;
export const storeContext = createContext<Store>(null!);
export const useStore = () => useContext(storeContext);
