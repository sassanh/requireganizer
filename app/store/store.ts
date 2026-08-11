"use client";

import {
  IMSTArray,
  Instance,
  SnapshotIn,
  cast,
  getSnapshot,
  types,
} from "mobx-state-tree";
import { createContext, useContext } from "react";

import {
  ArtifactListProposal,
  FragmentRevisionProposal,
} from "ai-harness/contracts";
import {
  materializeArtifactItems,
  PersistedArtifactItem,
} from "ai-harness/reconciliation";
import { parseJsoncObject } from "lib/json";
import {
  assertSafeVirtualPath,
  isSafeVirtualPath,
  parseScaffoldFiles,
} from "lib/scaffold";
import { uuid } from "utilities";
import { hydrateMissingLastGeneratedAt } from "utilities/testParser";

import {
  export as export_,
  generateAcceptanceCriteria,
  generateProductOverview,
  generateProjectConfig,
  generateRequirements,
  generateScaffold,
  generateTestCases,
  generateTestCode,
  generateTestScenarios,
  generateUserStories,
  handleComment,
  import as import_,
  exportCode,
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
  Status,
} from "./constants";
import {
  AcceptanceCriteria,
  AcceptanceCriteriaModel,
  Requirement,
  RequirementModel,
  StructuralFragment,
  StructuralFragmentModel,
  TestCase,
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

function createFragment(
  entityType: StructuralFragmentName,
  data: PersistedArtifactItem,
): StructuralFragment {
  const snapshot = { ...data, content: data.content ?? "" };

  switch (entityType) {
    case StructuralFragmentName.PrimaryFeature:
      return PrimaryFeatureModel.create(snapshot);
    case StructuralFragmentName.TargetUser:
      return TargetUserModel.create(snapshot);
    case StructuralFragmentName.Requirement:
      return RequirementModel.create(snapshot);
    case StructuralFragmentName.UserStory:
      return UserStoryModel.create(snapshot);
    case StructuralFragmentName.AcceptanceCriteria:
      return AcceptanceCriteriaModel.create(snapshot);
    case StructuralFragmentName.TestScenario:
      return TestScenarioModel.create(snapshot);
    case StructuralFragmentName.TestCase:
      return TestCaseModel.create(snapshot);
    case StructuralFragmentName.TestCode:
      throw new Error("Test code is managed as scaffold files, not fragments.");
  }
}

interface WorkflowInputSource {
  description: string;
  productOverview: unknown;
  userStories: readonly unknown[];
  requirements: readonly unknown[];
  acceptanceCriteria: readonly unknown[];
  testScenarios: readonly {
    id: string;
    type: StructuralFragmentName;
    content: string;
    priority: Priority | null;
    references: readonly unknown[];
    dependencies: readonly string[];
  }[];
}

function buildWorkflowInput(
  source: WorkflowInputSource,
  step: Step,
): Record<string, unknown> {
  const base = { description: source.description };
  if (step === Step.ProductOverview) return base;

  const withOverview = { ...base, productOverview: source.productOverview };
  if (step === Step.UserStories) return withOverview;

  const withStories = { ...withOverview, userStories: source.userStories };
  if (step === Step.Requirements) return withStories;

  const withRequirements = {
    ...withStories,
    requirements: source.requirements,
  };
  if (step === Step.AcceptanceCriteria) return withRequirements;

  const withCriteria = {
    ...withRequirements,
    acceptanceCriteria: source.acceptanceCriteria,
  };
  if (step === Step.TestScenarios) return withCriteria;

  if (step === Step.TestCases) {
    return {
      ...withCriteria,
      testScenarios: source.testScenarios.map((scenario) => ({
        id: scenario.id,
        type: scenario.type,
        content: scenario.content,
        priority: scenario.priority,
        references: scenario.references,
        dependencies: scenario.dependencies,
      })),
    };
  }

  return withCriteria;
}

function buildProjectConfigurationInput(
  source: WorkflowInputSource,
): Record<string, unknown> {
  return {
    ...buildWorkflowInput(source, Step.TestCases),
    testScenarios: source.testScenarios,
  };
}

class StoreEventEmitter {
  private readonly stepUpdateListeners = new Set<(step: Step) => void>();

  emit(_event: "stepUpdate", step: Step): void {
    this.stepUpdateListeners.forEach((listener) => listener(step));
  }

  on(_event: "stepUpdate", listener: (step: Step) => void): void {
    this.stepUpdateListeners.add(listener);
  }

  off(_event: "stepUpdate", listener: (step: Step) => void): void {
    this.stepUpdateListeners.delete(listener);
  }
}

export const ScaffoldFileModel = types.model({
  path: types.refinement(
    "SafeVirtualFilePath",
    types.string,
    isSafeVirtualPath,
  ),
  content: types.string,
});

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
    projectConfig: types.maybeNull(types.string),
    projectConfigLocked: types.optional(types.boolean, false),
    projectConfigInputFingerprint: types.maybeNull(types.string),
    isProjectConfigDialogOpen: types.optional(types.boolean, false),
    scaffoldFiles: types.array(ScaffoldFileModel),
    stageInputFingerprints: types.map(types.string),
  })
  .volatile(() => ({
    validationErrorDetails: null as string | null,
  }))
  .views((self) => {
    const eventTarget = new StoreEventEmitter();

    return {
      get eventTarget() {
        return eventTarget;
      },
      get hasGeneratedScaffold() {
        return self.scaffoldFiles.length > 0;
      }
    };
  })
  .actions((self) => ({
    reset() {
      self.isClean = true;
      self.businessCounter = 0;
      self.description = "";
      self.validationErrors = null;
      self.validationErrorDetails = null;

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
      self.projectConfig = null;
      self.projectConfigLocked = false;
      self.projectConfigInputFingerprint = null;
      self.isProjectConfigDialogOpen = false;
      self.scaffoldFiles = cast([]);
      self.stageInputFingerprints.clear();
    },
    setDescription({ description }: { description: string }) {
      self.description = description;
    },
    setValidationErrors({ validationErrors }: { validationErrors: string }) {
      self.validationErrors = validationErrors;
      self.validationErrorDetails = null;
    },
    setValidationError({
      message,
      details,
    }: {
      message: string;
      details?: string;
    }) {
      self.validationErrors = message;
      self.validationErrorDetails = details ?? null;
    },
    resetValidationErrors() {
      self.validationErrors = null;
      self.validationErrorDetails = null;
      self.systemMessage = null;
    },
    setProjectConfig(config: string) {
      self.projectConfig = config;
    },
    setProjectConfigLocked(locked: boolean) {
      self.projectConfigLocked = locked;
    },
    markProjectConfigCurrent() {
      self.projectConfigInputFingerprint = JSON.stringify(
        buildProjectConfigurationInput(self),
      );
    },
    markStageGenerated(step: Step) {
      self.stageInputFingerprints.set(
        step,
        JSON.stringify(buildWorkflowInput(self, step)),
      );
    },
    setProjectConfigDialogOpen(isOpen: boolean) {
      self.isProjectConfigDialogOpen = isOpen;
    },
    setScaffoldFiles(files: { path: string; content: string }[]) {
      self.scaffoldFiles = cast(parseScaffoldFiles(files));
    },
    setScaffoldFile(path: string, content: string) {
      const safePath = assertSafeVirtualPath(path);
      const existing = self.scaffoldFiles.find((file) => file.path === safePath);
      if (existing) {
        existing.content = content;
      } else {
        self.scaffoldFiles.push({ path: safePath, content });
      }
    },
    removeScaffoldFile(path: string) {
      const index = self.scaffoldFiles.findIndex((f) => f.path === path);
      if (index > -1) {
        self.scaffoldFiles.splice(index, 1);
      }
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
      self.eventTarget.emit("stepUpdate", Step.ProductOverview);
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
    resetIsBusy() {
      self.businessCounter = 0;
    },
    replaceArtifactList({
      entityType,
      parentId = "",
      items,
    }: ArtifactListProposal) {
      const list: IMSTArray<typeof StructuralFragmentModel> | undefined = {
        [StructuralFragmentName.PrimaryFeature]: () =>
          self.productOverview.primaryFeatures,
        [StructuralFragmentName.TargetUser]: () =>
          self.productOverview.targetUsers,
        [StructuralFragmentName.Requirement]: () => self.requirements,
        [StructuralFragmentName.UserStory]: () => self.userStories,
        [StructuralFragmentName.AcceptanceCriteria]: () =>
          self.acceptanceCriteria,
        [StructuralFragmentName.TestScenario]: () => self.testScenarios,
        [StructuralFragmentName.TestCase]: (parentId: string) =>
          self.testScenarios.find(({ id }) => id === parentId)?.testCases,
        [StructuralFragmentName.TestCode]: () => undefined,
      }[entityType](parentId);

      if (list == null) {
        throw new Error(
          `Cannot find the ${entityType} list${parentId ? ` for parent ${parentId}` : ""}.`,
        );
      }
      const existingById = new Map(list.map((item) => [item.id, item]));
      const snapshots = materializeArtifactItems(items, uuid).map((item) => {
        const existing = existingById.get(item.id);
        if (existing == null) {
          return getSnapshot(createFragment(entityType, item));
        }

        const { id: _id, ...update } = item;
        if (entityType === StructuralFragmentName.TestCase) {
          (existing as TestCase).setData(update);
        } else {
          existing.setData(update);
        }
        return getSnapshot(existing);
      });
      list.clear();
      list.push(...snapshots);
    },
    reviseFragment({ entityType, id, patch }: FragmentRevisionProposal) {
      if (entityType === StructuralFragmentName.TestCase) {
        let testCase: TestCase | undefined;
        self.testScenarios.forEach((scenario) => {
          testCase ??= scenario.testCases.find((candidate) => candidate.id === id);
        });
        if (testCase == null) {
          throw new Error(`Cannot revise missing test case ${id}.`);
        }
        testCase.setData(patch);
        return;
      }
      const fragments: StructuralFragment[] = [
        ...self.productOverview.primaryFeatures,
        ...self.productOverview.targetUsers,
        ...self.userStories,
        ...self.requirements,
        ...self.acceptanceCriteria,
        ...self.testScenarios,
      ];
      const fragment = fragments.find((candidate) => candidate.id === id);
      if (fragment == null || fragment.type !== entityType) {
        throw new Error(`Cannot revise missing ${entityType} fragment ${id}.`);
      }
      fragment.setData(patch);
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
    data(step: Step = LAST_STEP, includeBuildArtifacts = false) {
      return {
        ...(!isBefore(step, Step.Description)
          ? { description: self.description }
          : {}),
        ...(!isBefore(step, Step.ProductOverview)
          ? {
            productOverview: self.productOverview,
          }
          : {}),
        ...(!isBefore(step, Step.UserStories)
          ? { userStories: self.userStories }
          : {}),
        ...(!isBefore(step, Step.Requirements)
          ? { requirements: self.requirements }
          : {}),
        ...(!isBefore(step, Step.AcceptanceCriteria)
          ? { acceptanceCriteria: self.acceptanceCriteria }
          : {}),
        ...(!isBefore(step, Step.TestScenarios)
          ? { testScenarios: self.testScenarios }
          : {}),
        ...(includeBuildArtifacts && self.projectConfig != null
          ? {
            projectConfig: parseJsoncObject(
              self.projectConfig,
              "Project configuration",
            ),
          }
          : {}),
        ...(includeBuildArtifacts && self.scaffoldFiles.length > 0
          ? { scaffoldFiles: self.scaffoldFiles }
          : {}),
        ...(includeBuildArtifacts
          ? {
            stageInputFingerprints: Object.fromEntries(
              self.stageInputFingerprints.entries(),
            ),
            projectConfigInputFingerprint:
              self.projectConfigInputFingerprint,
          }
          : {}),
      };
    },
    get structuralFragmentsCache() {
      function extract(list: StructuralFragment[]) {
        return Object.fromEntries(
          list.map((fragment) => [fragment.id, fragment]),
        );
      }
      const testCases: StructuralFragment[] = [];
      self.testScenarios.forEach((testScenario) => {
        testScenario.testCases.forEach((testCase) => testCases.push(testCase));
      });

      return {
        ...extract(self.productOverview.primaryFeatures),
        ...extract(self.productOverview.targetUsers),
        ...extract(self.requirements),
        ...extract(self.userStories),
        ...extract(self.acceptanceCriteria),
        ...extract(self.testScenarios),
        ...extract(testCases),
      };
    },
    getCode(id: string) {
      return this.structuralFragmentsCache[id]?.getCode();
    },
    getPath(id: string) {
      const fragment = this.structuralFragmentsCache[id];
      if (!fragment) return undefined;
      return `?step=${STEP_BY_STRUCTURAL_FRAGMENT[fragment.type]}#${fragment.getCode()}`;
    },
    getStepStatus(step: Step): Status {
      const generatedInput = self.stageInputFingerprints.get(step);
      const isOutdated =
        generatedInput != null &&
        generatedInput !== JSON.stringify(buildWorkflowInput(self, step));
      const isGeneratedProjectOutdated =
        self.projectConfigInputFingerprint != null &&
        self.projectConfigInputFingerprint !==
          JSON.stringify(buildProjectConfigurationInput(self));
      const completedOrPending = (() => {
        switch (step) {
          case Step.Description:
            return self.description.trim().length > 0
              ? Status.Completed
              : Status.Pending;
          case Step.ProductOverview:
            return self.productOverview.isComplete
              ? Status.Completed
              : Status.Pending;
          case Step.Requirements:
            return self.requirements.length > 0
              ? Status.Completed
              : Status.Pending;
          case Step.UserStories:
            return self.userStories.length > 0
              ? Status.Completed
              : Status.Pending;
          case Step.AcceptanceCriteria:
            return self.acceptanceCriteria.length > 0
              ? Status.Completed
              : Status.Pending;
          case Step.TestScenarios:
            return self.testScenarios.length > 0
              ? Status.Completed
              : Status.Pending;
          case Step.TestCases:
            return self.testScenarios.length > 0 &&
              self.testScenarios.every(
                (testScenario) => testScenario.testCases.length > 0,
              )
              ? Status.Completed
              : Status.Pending;
          case Step.TestCode: {
            const testCases = self.testScenarios.flatMap(
              (testScenario) => testScenario.testCases,
            );
            if (
              testCases.length === 0 ||
              testCases.some(({ lastGeneratedAt }) => lastGeneratedAt == null)
            ) {
              return Status.Pending;
            }
            return isGeneratedProjectOutdated ||
              testCases.some(
                ({ lastGeneratedAt, lastModifiedAt }) =>
                  lastGeneratedAt != null &&
                  (lastModifiedAt ?? 0) > lastGeneratedAt,
              )
              ? Status.Outdated
              : Status.Completed;
          }
          case Step.Code:
            return self.hasGeneratedScaffold
              ? isGeneratedProjectOutdated
                ? Status.Outdated
                : Status.Completed
              : Status.Pending;
          default:
            return Status.Pending;
        }
      })();
      return completedOrPending === Status.Completed && isOutdated
        ? Status.Outdated
        : completedOrPending;
    },
    get isProjectConfigOutdated(): boolean {
      return (
        self.projectConfigInputFingerprint != null &&
        self.projectConfigInputFingerprint !==
          JSON.stringify(buildProjectConfigurationInput(self))
      );
    },
  }))
  .views((self) => ({
    json(step: Step) {
      return JSON.stringify(self.data(step));
    },
  }))
  .actions((self) => ({
    afterCreate() {
      // Recover generation timestamps from matching annotated test files.
      if (self.scaffoldFiles.length > 0) {
        hydrateMissingLastGeneratedAt(
          self.testScenarios,
          Array.from(self.scaffoldFiles),
          self.productOverview?.programmingLanguage || "typescript",
        );
      }
    }
  }));

export const Store = FlatStore.actions(
  withSelf({
    handleComment,
    generateProductOverview,
    generateUserStories,
    generateRequirements,
    generateAcceptanceCriteria,
    generateTestScenarios,
    generateTestCases,
    generateTestCode,
    generateProjectConfig,
    generateScaffold,
  }),
).actions(withSelf({ import: import_, export: export_, exportCode }));

export type FlatStore = Instance<typeof FlatStore>;
export type Store = Instance<typeof Store>;
export const storeContext = createContext<Store>(null!);
export const useStore = () => useContext(storeContext);
