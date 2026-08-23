"use client";

import {
  IMSTArray,
  Instance,
  SnapshotIn,
  applySnapshot,
  cast,
  getSnapshot,
  types,
} from "mobx-state-tree";
import { createContext, useContext } from "react";

import type {
  ArtifactListProposal,
  FragmentRevisionProposal,
  ProductOverviewProposal,
  TestCodeProposal,
} from "ai-harness/contracts";
import {
  materializeArtifactItems,
  type PersistedArtifactItem,
} from "ai-harness/reconciliation";
import {
  type BoundaryDesign,
  type ContractSuite,
  type ImplementationProfile,
  type ProjectSetup,
  type TestCaseDefinition,
  type TestScenarioBinding,
  fingerprint,
  validateBoundaryDesign,
  validateContractSuite,
  validateImplementationProfile,
} from "contract-domain";
import { PROJECT_SCHEMA_VERSION } from "lib/projectSchema";
import {
  assertSafeVirtualPath,
  isSafeVirtualPath,
  parseScaffoldFiles,
} from "lib/scaffold";
import type { ProviderCallMetadata, ProviderCallRecord } from "lib/types";
import { uuid } from "utilities";

import {
  export as export_,
  exportCode,
  generateAcceptanceCriteria,
  generateBoundaryDesign,
  generateImplementationProfile,
  generateInterfaceContracts,
  generateProductOverview,
  generateProjectSetup,
  generateRequirements,
  generateTestCases,
  generateTestCode,
  generateTestScenarios,
  generateUserStories,
  handleComment,
  import as import_,
  reviseFormalContract,
  sendConversationMessage,
  branchFromMessage,
  regenerateLastReply,
} from "./actions";
import {
  GENERATION_PREREQUISITE_BY_STEP,
  LAST_STEP,
  Priority,
  STEP_BY_STRUCTURAL_FRAGMENT,
  STEPS,
  Status,
  Step,
  StructuralFragment as StructuralFragmentName,
  isBefore,
} from "./constants";
import {
  AcceptanceCriteria,
  AcceptanceCriteriaModel,
  Requirement,
  RequirementModel,
  StructuralFragment,
  StructuralFragmentModel,
  TestCase,
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

export { PROJECT_SCHEMA_VERSION } from "lib/projectSchema";
const MAX_PROVIDER_CALL_HISTORY = 100;

export interface PendingImpactChange {
  sourceStep: Step;
  sourceLabel: string;
  affectedSteps: Step[];
  affectedArtifacts: Array<{
    step: Step;
    label: string;
    reason: string;
  }>;
  summary: string;
  candidateSnapshot: unknown;
}

export interface TestScenarioSnapshotInput {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  references: { id: string; type: StructuralFragmentName }[];
  dependencies: string[];
  binding: TestScenarioBinding;
  revisionId: string;
  revision: number;
  testCases?: SnapshotIn<TestCase>[];
}

export interface TestCaseSnapshotInput {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  references: { id: string; type: StructuralFragmentName }[];
  dependencies: string[];
  definition: TestCaseDefinition;
  revisionId: string;
  revision: number;
  generatedInputFingerprint?: string | null;
}

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
    case StructuralFragmentName.TestCase:
    case StructuralFragmentName.TestCode:
      throw new Error(`${entityType} is managed by the contract-first workflow.`);
  }
}

interface WorkflowInputSource {
  description: string;
  productOverview: unknown;
  userStories: readonly unknown[];
  requirements: readonly unknown[];
  acceptanceCriteria: readonly unknown[];
  boundaryDesign: BoundaryDesign | null;
  implementationProfile: ImplementationProfile | null;
  contractSuite: ContractSuite | null;
  testScenarios: readonly TestScenario[];
  projectSetup: ProjectSetup | null;
}

function scenarioDesign(scenarios: readonly TestScenario[]) {
  return scenarios.map((scenario) => ({
    id: scenario.id,
    content: scenario.content,
    description: scenario.description,
    priority: scenario.priority,
    references: scenario.references.map(({ id, type }) => ({ id, type })),
    dependencies: Array.from(scenario.dependencies),
    binding: scenario.binding,
    revisionId: scenario.revisionId,
    revision: scenario.revision,
    testCases: scenario.testCases.map((testCase) => ({
      id: testCase.id,
      title: testCase.title,
      description: testCase.description,
      priority: testCase.priority,
      references: testCase.references.map(({ id, type }) => ({ id, type })),
      dependencies: Array.from(testCase.dependencies),
      definition: testCase.definition,
      revisionId: testCase.revisionId,
      revision: testCase.revision,
    })),
  }));
}

export function buildWorkflowInput(
  source: WorkflowInputSource,
  step: Step,
): Record<string, unknown> {
  const result: Record<string, unknown> = { description: source.description };
  if (step === Step.ProductOverview) return result;
  result.productOverview = source.productOverview;
  if (step === Step.UserStories) return result;
  result.userStories = source.userStories;
  if (step === Step.Requirements) return result;
  result.requirements = source.requirements;
  if (step === Step.AcceptanceCriteria) return result;
  result.acceptanceCriteria = source.acceptanceCriteria;
  if (step === Step.BoundaryDesign) return result;
  result.boundaryDesign = source.boundaryDesign;
  if (step === Step.InterfaceContracts) return result;
  result.implementationProfile = source.implementationProfile;
  result.contractSuite = source.contractSuite;
  if (step === Step.TestScenarios) return result;
  result.testScenarios = scenarioDesign(source.testScenarios).map(
    ({ testCases: _testCases, ...scenario }) => scenario,
  );
  if (step === Step.TestCases) return result;
  result.testScenarios = scenarioDesign(source.testScenarios);
  if (step === Step.ProjectSetup) return result;
  result.projectSetup = source.projectSetup;
  return result;
}

export function workflowFingerprint(source: WorkflowInputSource, step: Step) {
  return fingerprint(buildWorkflowInput(source, step));
}

export function testDesignFingerprint(source: WorkflowInputSource): string {
  return fingerprint({
    boundaryRevisionId: source.boundaryDesign?.revisionId,
    profileRevisionId: source.implementationProfile?.revisionId,
    contractSuiteRevisionId: source.contractSuite?.revisionId,
    scenarios: scenarioDesign(source.testScenarios),
  });
}

class StoreEventEmitter {
  private readonly listeners = new Set<(step: Step) => void>();

  emit(_event: "stepUpdate", step: Step): void {
    this.listeners.forEach((listener) => listener(step));
  }

  on(_event: "stepUpdate", listener: (step: Step) => void): void {
    this.listeners.add(listener);
  }

  off(_event: "stepUpdate", listener: (step: Step) => void): void {
    this.listeners.delete(listener);
  }
}

export const ScaffoldFileModel = types.model({
  path: types.refinement("SafeVirtualFilePath", types.string, isSafeVirtualPath),
  content: types.string,
});

export const FlatStore = types
  .model("Store", {
    schemaVersion: types.optional(types.literal(PROJECT_SCHEMA_VERSION), PROJECT_SCHEMA_VERSION),
    isClean: types.optional(types.boolean, true),
    businessCounter: types.optional(types.number, 0),
    description: types.optional(types.string, ""),
    validationErrors: types.maybeNull(types.string),
    productOverview: ProductOverviewModel,
    userStories: types.array(UserStoryModel),
    requirements: types.array(RequirementModel),
    acceptanceCriteria: types.array(AcceptanceCriteriaModel),
    boundaryDesign: types.maybeNull(types.frozen<BoundaryDesign>()),
    implementationProfile: types.maybeNull(types.frozen<ImplementationProfile>()),
    contractSuite: types.maybeNull(types.frozen<ContractSuite>()),
    testScenarios: types.array(TestScenarioModel),
    projectSetup: types.maybeNull(types.frozen<ProjectSetup>()),
    scaffoldFiles: types.array(ScaffoldFileModel),
    stageInputFingerprints: types.map(types.string),
    systemMessage: types.maybeNull(types.string),
    conversation: types.optional(types.frozen<unknown[]>(), []),
    conversationSidebarOpen: false,
  })
  .volatile(() => ({
    validationErrorDetails: null as string | null,
    providerCalls: [] as ProviderCallRecord[],
    pendingImpactChange: null as PendingImpactChange | null,
    contractRevisionDiff: null as string | null,
    thinkingLabel: null as string | null,
    thinkingText: "",
    aiAbortController: null as AbortController | null,
    activeAgent: null as { abort(): void } | null,
  }))
  .views(() => {
    const eventTarget = new StoreEventEmitter();
    return { get eventTarget() { return eventTarget; } };
  })
  .actions((self) => ({
    reset() {
      self.isClean = true;
      self.businessCounter = 0;
      self.description = "";
      self.validationErrors = null;
      self.validationErrorDetails = null;
      self.productOverview = ProductOverviewModel.create({});
      self.userStories = cast([]);
      self.requirements = cast([]);
      self.acceptanceCriteria = cast([]);
      self.boundaryDesign = null;
      self.implementationProfile = null;
      self.contractSuite = null;
      self.testScenarios = cast([]);
      self.projectSetup = null;
      self.scaffoldFiles = cast([]);
      self.stageInputFingerprints.clear();
      self.systemMessage = null;
      self.pendingImpactChange = null;
      self.contractRevisionDiff = null;
      self.thinkingLabel = null;
      self.thinkingText = "";
      self.aiAbortController = null;
      self.activeAgent = null;
      self.conversation = cast([]);
    },
    setDescription({ description }: { description: string }) {
      self.description = description;
    },
    setValidationErrors({ validationErrors }: { validationErrors: string }) {
      self.validationErrors = validationErrors;
      self.validationErrorDetails = null;
    },
    setValidationError({ message, details }: { message: string; details?: string }) {
      self.validationErrors = message;
      self.validationErrorDetails = details ?? null;
    },
    resetValidationErrors() {
      self.validationErrors = null;
      self.validationErrorDetails = null;
      self.systemMessage = null;
    },
    communicate({ description }: { description: string }) {
      self.systemMessage = description;
    },
    clearMessage() {
      self.systemMessage = null;
    },
    recordProviderCalls(calls: ProviderCallMetadata[]) {
      if (calls.length === 0) return;
      self.providerCalls = [
        ...self.providerCalls,
        ...calls.map((call) => ({ ...call, id: uuid() })),
      ].slice(-MAX_PROVIDER_CALL_HISTORY);
    },
    hydrateProviderCalls(calls: ProviderCallRecord[]) {
      self.providerCalls = calls.slice(-MAX_PROVIDER_CALL_HISTORY);
    },
    deleteProviderCall(id: string) {
      self.providerCalls = self.providerCalls.filter((call) => call.id !== id);
    },
    clearProviderCalls() {
      self.providerCalls = [];
    },
    setContractRevisionDiff(diff: string | null) {
      self.contractRevisionDiff = diff;
    },
    queueImpactChange(change: PendingImpactChange) {
      self.pendingImpactChange = change;
    },
    beginAiOperation({
      operation,
      controller,
    }: {
      operation: string;
      controller: AbortController;
    }) {
      self.aiAbortController = controller;
      self.thinkingLabel = operation;
      self.thinkingText = "";
    },
    appendThinking(delta: string) {
      self.thinkingText += delta;
    },
    beginThinkingSegment() {
      if (self.thinkingLabel == null || self.thinkingText.length === 0) return;
      self.thinkingText += "\n\n———\n\n";
    },
    endAiOperation() {
      self.thinkingLabel = null;
      self.thinkingText = "";
      self.aiAbortController = null;
    },
    setActiveAgent(agent: { abort(): void } | null) {
      self.activeAgent = agent;
    },
    clearActiveAgent() {
      self.activeAgent = null;
    },
    setConversation(messages: unknown[]) {
      self.conversation = cast(messages);
    },
    setConversationSidebar(open: boolean) {
      self.conversationSidebarOpen = open;
    },
    abortAiOperation() {
      self.activeAgent?.abort();
      self.aiAbortController?.abort();
    },
    cancelPendingImpactChange() {
      self.pendingImpactChange = null;
      self.contractRevisionDiff = null;
    },
    applyPendingImpactChange() {
      if (self.pendingImpactChange == null) return;
      const snapshot = self.pendingImpactChange.candidateSnapshot;
      self.pendingImpactChange = null;
      applySnapshot(self, snapshot as SnapshotIn<typeof FlatStore>);
    },
    markStageGenerated(step: Step) {
      self.stageInputFingerprints.set(step, workflowFingerprint(self, step));
    },
    setScaffoldFiles(files: { path: string; content: string }[]) {
      self.scaffoldFiles = cast(parseScaffoldFiles(files));
    },
    setScaffoldFile(path: string, content: string) {
      const safePath = assertSafeVirtualPath(path);
      const existing = self.scaffoldFiles.find((file) => file.path === safePath);
      if (existing) existing.content = content;
      else self.scaffoldFiles.push({ path: safePath, content });
    },
    removeScaffoldFile(path: string) {
      const index = self.scaffoldFiles.findIndex((file) => file.path === path);
      if (index >= 0) self.scaffoldFiles.splice(index, 1);
    },
  }))
  .actions((self) => ({
    initialize(info: ProductOverviewProposal) {
      self.productOverview = ProductOverviewModel.create({
        name: info.name,
        purpose: info.purpose,
        primaryFeatures: info.primaryFeatures.map((content) => ({ content })),
        targetUsers: info.targetUsers.map((content) => ({ content })),
      });
      self.eventTarget.emit("stepUpdate", Step.ProductOverview);
    },
    setName({ name }: { name: string }) {
      self.productOverview.name = name;
    },
    setPurpose({ purpose }: { purpose: string }) {
      self.productOverview.purpose = purpose;
    },
    setPrimaryFeatures({ primaryFeatures }: { primaryFeatures: SnapshotIn<PrimaryFeature>[] }) {
      self.productOverview.primaryFeatures = cast(primaryFeatures);
    },
    setTargetUsers({ targetUsers }: { targetUsers: SnapshotIn<TargetUser>[] }) {
      self.productOverview.targetUsers = cast(targetUsers);
    },
    setProductOverview(productOverview: ProductOverview) {
      self.productOverview = cast(productOverview);
    },
    setUserStories({ userStories }: { userStories: SnapshotIn<UserStory>[] }) {
      self.isClean = false;
      self.userStories = cast(userStories);
    },
    setRequirements({ requirements }: { requirements: SnapshotIn<Requirement>[] }) {
      self.isClean = false;
      self.requirements = cast(requirements);
    },
    setAcceptanceCriteria({
      acceptanceCriteria,
    }: {
      acceptanceCriteria: SnapshotIn<AcceptanceCriteria>[];
    }) {
      self.isClean = false;
      self.acceptanceCriteria = cast(acceptanceCriteria);
    },
    addUserStory() {
      self.userStories.push(UserStoryModel.create({ content: "New User Story" }));
    },
    addRequirement() {
      self.requirements.push(RequirementModel.create({ content: "New Requirement" }));
    },
    addAcceptanceCriteria() {
      self.acceptanceCriteria.push(
        AcceptanceCriteriaModel.create({ content: "New Acceptance Criteria" }),
      );
    },
    removeUserStory({ fragment }: { fragment: UserStory }) {
      self.userStories.remove(fragment);
    },
    removeRequirement({ fragment }: { fragment: Requirement }) {
      self.requirements.remove(fragment);
    },
    removeAcceptanceCriteria({ fragment }: { fragment: AcceptanceCriteria }) {
      self.acceptanceCriteria.remove(fragment);
    },
    setBoundaryDesign(design: BoundaryDesign) {
      self.boundaryDesign = cast(design);
    },
    updateBoundaryText(
      collection: "subjects" | "interfaces" | "interactions" | "verificationObligations",
      id: string,
      field: string,
      value: string,
    ) {
      if (self.boundaryDesign == null) return;
      self.boundaryDesign = cast({
        ...self.boundaryDesign,
        [collection]: self.boundaryDesign[collection].map((item) =>
          item.id === id ? { ...item, [field]: value } : item,
        ),
      });
    },
    setImplementationProfile(profile: ImplementationProfile) {
      self.implementationProfile = cast(profile);
    },
    updateImplementationProfile(
      field:
        | "platform"
        | "runtime"
        | "language"
        | "framework"
        | "moduleSystem"
        | "buildEcosystem"
        | "testEcosystem",
      value: string,
    ) {
      if (self.implementationProfile == null) {
        return;
      }
      self.implementationProfile = cast({
        ...self.implementationProfile,
        [field]: value,
      });
    },
    updateImplementationProfileConstraints(value: string) {
      if (self.implementationProfile == null) {
        return;
      }
      self.implementationProfile = cast({
        ...self.implementationProfile,
        constraints: value
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean),
      });
    },
    setContractSuite(suite: ContractSuite) {
      self.contractSuite = cast(suite);
    },
    setTestScenarios(scenarios: TestScenarioSnapshotInput[]) {
      self.testScenarios = cast(
        scenarios.map((scenario) => ({
          id: scenario.id,
          type: StructuralFragmentName.TestScenario as const,
          content: scenario.title,
          description: scenario.description,
          priority: scenario.priority,
          references: scenario.references,
          dependencies: scenario.dependencies,
          binding: scenario.binding,
          revisionId: scenario.revisionId,
          revision: scenario.revision,
          testCases: scenario.testCases ?? [],
        })) as SnapshotIn<TestScenario>[],
      );
    },
    replaceTestCases(scenarioId: string, cases: TestCaseSnapshotInput[]) {
      const scenario = self.testScenarios.find(({ id }) => id === scenarioId);
      if (scenario == null) throw new Error(`Cannot find test scenario ${scenarioId}.`);
      scenario.setTestCases(
        cases.map((testCase) => ({
          id: testCase.id,
          type: StructuralFragmentName.TestCase,
          content: testCase.description,
          description: testCase.description,
          title: testCase.title,
          priority: testCase.priority,
          references: testCase.references,
          dependencies: testCase.dependencies,
          definition: testCase.definition,
          revisionId: testCase.revisionId,
          revision: testCase.revision,
          generatedInputFingerprint: testCase.generatedInputFingerprint ?? null,
        })),
      );
    },
    setProjectSetup(setup: ProjectSetup) {
      self.projectSetup = cast(setup);
      self.setScaffoldFiles(setup.files);
      self.testScenarios.forEach((scenario) =>
        scenario.testCases.forEach((testCase) => testCase.clearGenerated()),
      );
      self.markStageGenerated(Step.ProjectSetup);
    },
    markTestGenerated(testCaseId: string, inputFingerprint: string) {
      for (const scenario of self.testScenarios) {
        const testCase = scenario.testCases.find(({ id }) => id === testCaseId);
        if (testCase != null) {
          testCase.markGenerated(inputFingerprint);
          return;
        }
      }
      throw new Error(`Cannot mark missing test case ${testCaseId} as generated.`);
    },
  }))
  .actions((self) => ({
    replaceArtifactList({ entityType, items }: ArtifactListProposal) {
      const list = {
        [StructuralFragmentName.PrimaryFeature]: () => self.productOverview.primaryFeatures,
        [StructuralFragmentName.TargetUser]: () => self.productOverview.targetUsers,
        [StructuralFragmentName.Requirement]: () => self.requirements,
        [StructuralFragmentName.UserStory]: () => self.userStories,
        [StructuralFragmentName.AcceptanceCriteria]: () => self.acceptanceCriteria,
        [StructuralFragmentName.TestScenario]: () => undefined,
        [StructuralFragmentName.TestCase]: () => undefined,
        [StructuralFragmentName.TestCode]: () => undefined,
      }[entityType]();
      if (list == null) throw new Error(`${entityType} requires a contract-first proposal.`);
      const existingById = new Map(list.map((item) => [item.id, item]));
      const snapshots = materializeArtifactItems(items, uuid).map((item) => {
        const existing = existingById.get(item.id);
        if (existing == null) return getSnapshot(createFragment(entityType, item));
        const { id: _id, ...update } = item;
        existing.setData(update);
        return getSnapshot(existing);
      });
      list.replace(snapshots as never[]);
    },
    reviseFragment({ entityType, id, patch }: FragmentRevisionProposal) {
      const fragments: StructuralFragment[] = [
        ...self.productOverview.primaryFeatures,
        ...self.productOverview.targetUsers,
        ...self.userStories,
        ...self.requirements,
        ...self.acceptanceCriteria,
      ];
      const fragment = fragments.find((candidate) => candidate.id === id);
      if (fragment == null || fragment.type !== entityType) {
        throw new Error(`Cannot revise missing ${entityType} fragment ${id}.`);
      }
      fragment.setData(patch);
    },
  }))
  .views((self) => ({
    get isBusy() {
      return self.businessCounter > 0;
    },
    get testCases() {
      return self.testScenarios.flatMap((scenario) => scenario.testCases);
    },
    get hasGeneratedScaffold() {
      return self.projectSetup != null && self.scaffoldFiles.length > 0;
    },
    get contractsReady() {
      return (
        self.implementationProfile != null &&
        self.contractSuite != null &&
        self.contractSuite.interfaceContracts.length > 0 &&
        self.contractSuite.subjectContracts.length > 0
      );
    },
    get testDesignFingerprint() {
      return testDesignFingerprint(self);
    },
    data(step: Step = LAST_STEP, includeBuildArtifacts = false) {
      return {
        schemaVersion: PROJECT_SCHEMA_VERSION,
        ...(!isBefore(step, Step.Description) ? { description: self.description } : {}),
        ...(!isBefore(step, Step.ProductOverview)
          ? { productOverview: self.productOverview }
          : {}),
        ...(!isBefore(step, Step.UserStories) ? { userStories: self.userStories } : {}),
        ...(!isBefore(step, Step.Requirements) ? { requirements: self.requirements } : {}),
        ...(!isBefore(step, Step.AcceptanceCriteria)
          ? { acceptanceCriteria: self.acceptanceCriteria }
          : {}),
        ...(!isBefore(step, Step.BoundaryDesign)
          ? { boundaryDesign: self.boundaryDesign }
          : {}),
        ...(!isBefore(step, Step.InterfaceContracts)
          ? {
              implementationProfile: self.implementationProfile,
              contractSuite: self.contractSuite,
            }
          : {}),
        ...(!isBefore(step, Step.TestScenarios)
          ? { testScenarios: self.testScenarios }
          : {}),
        ...(includeBuildArtifacts
          ? {
              projectSetup: self.projectSetup,
              scaffoldFiles: self.scaffoldFiles,
              stageInputFingerprints: Object.fromEntries(
                self.stageInputFingerprints.entries(),
              ),
            }
          : {}),
      };
    },
    get structuralFragmentsCache() {
      const all = [
        ...self.productOverview.primaryFeatures,
        ...self.productOverview.targetUsers,
        ...self.userStories,
        ...self.requirements,
        ...self.acceptanceCriteria,
        ...self.testScenarios,
        ...self.testScenarios.flatMap((scenario) => scenario.testCases),
      ] as unknown as StructuralFragment[];
      return Object.fromEntries(all.map((fragment) => [fragment.id, fragment]));
    },
  }))
  .views((self) => ({
    get projectSetupIsCurrent() {
      return !(
        self.projectSetup != null &&
        (
          self.projectSetup.boundaryRevisionId !== self.boundaryDesign?.revisionId ||
          self.projectSetup.profileRevisionId !== self.implementationProfile?.revisionId ||
          self.projectSetup.contractSuiteRevisionId !== self.contractSuite?.revisionId ||
          self.projectSetup.testDesignFingerprint !== testDesignFingerprint(self)
        )
      );
    },
  }))
  .views((self) => ({
    getCode(id: string) {
      return self.structuralFragmentsCache[id]?.getCode();
    },
    getPath(id: string) {
      const fragment = self.structuralFragmentsCache[id];
      if (fragment == null) return undefined;
      return `?step=${STEP_BY_STRUCTURAL_FRAGMENT[fragment.type]}#${fragment.getCode()}`;
    },
    get isProjectSetupOutdated() {
      return self.projectSetup != null && !self.projectSetupIsCurrent;
    },
    getStepStatus(step: Step): Status {
      const generated = self.stageInputFingerprints.get(step);
      const inputIsOutdated =
        generated != null && generated !== workflowFingerprint(self, step);
      let status: Status;
      switch (step) {
        case Step.Description:
          status = self.description.trim() ? Status.Completed : Status.Pending;
          break;
        case Step.ProductOverview:
          status = self.productOverview.isComplete ? Status.Completed : Status.Pending;
          break;
        case Step.UserStories:
          status = self.userStories.length > 0 ? Status.Completed : Status.Pending;
          break;
        case Step.Requirements:
          status = self.requirements.length > 0 ? Status.Completed : Status.Pending;
          break;
        case Step.AcceptanceCriteria:
          status = self.acceptanceCriteria.length > 0 ? Status.Completed : Status.Pending;
          break;
        case Step.BoundaryDesign:
          status = self.boundaryDesign != null ? Status.Completed : Status.Pending;
          break;
        case Step.InterfaceContracts:
          status = self.contractsReady ? Status.Completed : Status.Pending;
          if (
            status === Status.Completed &&
            (
              self.contractSuite?.boundaryRevisionId !== self.boundaryDesign?.revisionId ||
              self.contractSuite?.profileRevisionId !== self.implementationProfile?.revisionId ||
              self.implementationProfile?.boundaryRevisionId !== self.boundaryDesign?.revisionId
            )
          ) {
            status = Status.Outdated;
          }
          break;
        case Step.TestScenarios:
          status =
            self.testScenarios.length > 0 && self.testScenarios.every(({ binding }) => binding != null)
              ? Status.Completed
              : Status.Pending;
          break;
        case Step.TestCases:
          status =
            self.testScenarios.length > 0 &&
            self.testScenarios.every(
              (scenario) =>
                scenario.testCases.length > 0 &&
                scenario.testCases.every(({ definition }) => definition != null),
            )
              ? Status.Completed
              : Status.Pending;
          break;
        case Step.ProjectSetup:
          status = self.projectSetup == null ? Status.Pending : Status.Completed;
          if (status === Status.Completed && !self.projectSetupIsCurrent) {
            status = Status.Outdated;
          }
          break;
        case Step.AutomatedTests: {
          const hasGeneratedTests = self.testScenarios.some((scenario) =>
            scenario.testCases.some(
              ({ generatedInputFingerprint }) =>
                generatedInputFingerprint != null,
            ),
          );
          if (
            self.projectSetup == null ||
            self.testScenarios.reduce((count, scenario) => count + scenario.testCases.length, 0) === 0
          ) {
            status = Status.Pending;
          } else if (!self.projectSetupIsCurrent) {
            status = hasGeneratedTests ? Status.Outdated : Status.Pending;
          } else {
            const statuses = self.testScenarios.reduce<Array<"not-generated" | "generated" | "out-of-sync">>(
              (result, scenario) => [
                ...result,
                ...Array.from(scenario.testCases).map((testCase) => testCase.testStatus),
              ],
              [],
            );
            status = statuses.every((testStatus) => testStatus === "generated")
              ? Status.Completed
              : statuses.some((testStatus) => testStatus === "out-of-sync")
                ? Status.Outdated
                : Status.Pending;
          }
          break;
        }
        case Step.Code:
          status = Status.Pending;
          break;
      }
      return status === Status.Completed && inputIsOutdated ? Status.Outdated : status;
    },
  }))
  .views((self) => ({
    canGenerateStep(step: Step): boolean {
      const prerequisite = GENERATION_PREREQUISITE_BY_STEP[step];
      return prerequisite != null && self.getStepStatus(prerequisite) === Status.Completed;
    },
  }))
  .views((self) => {
    const hasStepArtifacts = (step: Step): boolean => {
      switch (step) {
        case Step.Description:
          return self.description.trim().length > 0;
        case Step.ProductOverview:
          return !self.productOverview.isEmpty;
        case Step.UserStories:
          return self.userStories.length > 0;
        case Step.Requirements:
          return self.requirements.length > 0;
        case Step.AcceptanceCriteria:
          return self.acceptanceCriteria.length > 0;
        case Step.BoundaryDesign:
          return self.boundaryDesign != null;
        case Step.InterfaceContracts:
          return self.implementationProfile != null || self.contractSuite != null;
        case Step.TestScenarios:
          return self.testScenarios.length > 0;
        case Step.TestCases:
          return self.testScenarios.some(
            ({ testCases }) => testCases.length > 0,
          );
        case Step.ProjectSetup:
          return self.projectSetup != null;
        case Step.AutomatedTests:
          return self.testScenarios.some((scenario) =>
            scenario.testCases.some(
              ({ generatedInputFingerprint }) =>
                generatedInputFingerprint != null,
            ),
          );
        case Step.Code:
          return false;
      }
    };

    return {
      json(step: Step) {
        return JSON.stringify(self.data(step));
      },
      hasStepArtifacts,
      affectedDownstreamSteps(
        sourceStep: Step,
        includeSourceStep = false,
      ): Step[] {
        return STEPS.slice(
          STEPS.indexOf(sourceStep) + (includeSourceStep ? 0 : 1),
        ).filter(
          (step) =>
            step !== Step.Code &&
            (
              self.getStepStatus(step) !== Status.Pending ||
              hasStepArtifacts(step)
            ),
        );
      },
    };
  });

export const Store = FlatStore.actions(
  withSelf({
    handleComment,
    sendConversationMessage,
    branchFromMessage,
    regenerateLastReply,
    generateProductOverview,
    generateUserStories,
    generateRequirements,
    generateAcceptanceCriteria,
    generateBoundaryDesign,
    generateImplementationProfile,
    generateInterfaceContracts,
    reviseFormalContract,
    generateTestScenarios,
    generateTestCases,
    generateProjectSetup,
    generateTestCode,
  }),
).actions(withSelf({ import: import_, export: export_, exportCode }));

export type FlatStore = Instance<typeof FlatStore>;
export type Store = Instance<typeof Store>;
export const storeContext = createContext<Store>(null!);
export const useStore = () => useContext(storeContext);
