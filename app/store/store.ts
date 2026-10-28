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

import type { AiCommand, CommandStage, RevisionTarget } from "ai-agent/command";
import { aiSettings, reviewerModel } from "ai-agent/settings";
import { hydrateConversationThinking } from "ai-agent/thinking";
import type {
  ArtifactListProposal,
  FragmentRevisionProposal,
  ProductOverviewPatchItem,
  ProductOverviewProposal,
  TestCodeProposal,
} from "ai-harness/contracts";
import {
  materializeArtifactItems,
  type PersistedArtifactItem,
} from "ai-harness/reconciliation";
import {
  type Signature,
  type ApprovalStatus,
  type BoundaryDesign,
  type JsonValue,
  type ModelVerdict,
  type RevisionMetadata,
  type Reviewer,
  type VerdictDecision,
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
import { UserFacingError } from "lib/errors";
import { MODULE_SCHEMA_VERSION } from "lib/projectSchema";
import { mergeProviderCalls } from "lib/providerCallStorage";
import {
  assertSafeVirtualPath,
  isSafeVirtualPath,
  parseScaffoldFiles,
} from "lib/scaffold";
import type { ProviderCallMetadata, ProviderCallRecord } from "lib/types";
import { uuid } from "utilities";


import {
  answerThread,
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
  import as import_,
  refreshStage,
  reviewStage,
  sendConversationMessage,
  submitAgentProposal,
  regenerateLastReply,
} from "./actions";
import { bindFlowAction } from "./actions/ai-actions/utilities";
import {
  GENERATION_PREREQUISITE_BY_WORKFLOW_STAGE,
  GENERATOR_ACTION_BY_WORKFLOW_STAGE,
  LAST_WORKFLOW_STAGE,
  Priority,
  WORKFLOW_STAGE_BY_STRUCTURAL_FRAGMENT,
  WORKFLOW_STAGES,
  WORKFLOW_STAGE_LABELS,
  OVERVIEW_PURPOSE_QUALITY_ID,
  Status,
  WorkflowStage,
  refreshGuidance,
  type GeneratorActionName,
  StructuralFragment as StructuralFragmentName,
  isAfter,
  isBefore,
} from "./constants";
import {
  collectMechanicalIssues,
  type IntegrityGraph,
  type IntegrityItem,
  type MechanicalIssue,
} from "./integrity";
import {
  classifyListChange,
  listChangeCaption,
  type ListChange,
  type ListChangeAfterItem,
  type ListChangeBeforeItem,
  regeneratedList,
} from "./listChange";
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
import type { ReferenceData } from "./models/StructuralFragment";
import {
  COVERAGE_STAGE_BY_PARENT_TYPE,
  COVERAGE_STAGES,
  EMPTY_REVIEW_BOOK,
  IMPACT_STAGES,
  MISSING_REVISION,
  PERSON,
  PROGRESS_STAGES,
  type ReviewBook,
  type ReviewMode,
  type ReviewStatus,
  type ReviewUnit,
  STAGE_INPUTS,
  type StandaloneReview,
  checkedHash,
  coverageParentId,
  coverageUnitId,
  holds,
  impactStage,
  impactUnitId,
  itemSetRevision,
  proseRevision,
  reviewStatusOf,
  revisionListing,
  signatureRecord,
  signedText,
} from "./review";
import {
  type ReviewThread,
  type ThreadAnswer,
  type ThreadAnswerer,
  type ThreadAuthor,
  waitsForPerson,
  withMessage,
} from "./threads";
import { declareTimelineStep } from "./timeline/controller";
import { withSelf } from "./utilities";

export { MODULE_SCHEMA_VERSION, PROJECT_SCHEMA_VERSION } from "lib/projectSchema";
const MAX_PROVIDER_CALL_HISTORY = 100;

export interface PendingImpactChange {
  sourceStep: WorkflowStage;
  sourceLabel: string;
  affectedSteps: WorkflowStage[];
  affectedArtifacts: Array<{
    step: WorkflowStage;
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
  signature?: Signature | null;
  verdict?: ModelVerdict | null;
  basis: Record<string, string> | null;
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
  signature?: Signature | null;
  verdict?: ModelVerdict | null;
  basis: Record<string, string> | null;
  generatedInputFingerprint?: string | null;
}

function integrityItem(fragment: {
  id: string;
  type: StructuralFragmentName;
  content: string;
  references: readonly { id: string; type: StructuralFragmentName }[];
  dependencies: readonly string[];
}): IntegrityItem {
  return {
    id: fragment.id,
    type: fragment.type,
    content: fragment.content,
    references: fragment.references.map(({ id, type }) => ({ id, type })),
    dependencies: [...fragment.dependencies],
  };
}

function criterionIdsFrom(
  references: readonly { id: string; type: StructuralFragmentName }[],
): string[] {
  return references
    .filter(({ type }) => type === StructuralFragmentName.AcceptanceCriteria)
    .map(({ id }) => id);
}

function integrityGraphFromStore(source: {
  productOverview: ProductOverview;
  userStories: readonly UserStory[];
  requirements: readonly Requirement[];
  acceptanceCriteria: readonly AcceptanceCriteria[];
  boundaryDesign: BoundaryDesign | null;
  testScenarios: readonly TestScenario[];
}): IntegrityGraph {
  return {
    productOverview: {
      purpose: source.productOverview.purpose,
      primaryFeatures: source.productOverview.primaryFeatures.map(integrityItem),
      targetUsers: source.productOverview.targetUsers.map(integrityItem),
    },
    userStories: source.userStories.map(integrityItem),
    requirements: source.requirements.map(integrityItem),
    acceptanceCriteria: source.acceptanceCriteria.map(integrityItem),
    boundaryDesign: source.boundaryDesign,
    testScenarios: source.testScenarios.map((scenario) => ({
      id: scenario.id,
      criterionIds: criterionIdsFrom(scenario.references),
      testCases: scenario.testCases.map((testCase) => ({
        id: testCase.id,
        criterionIds: criterionIdsFrom(testCase.references),
      })),
    })),
  };
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

interface TestDesignSource {
  boundaryDesign: BoundaryDesign | null;
  implementationProfile: ImplementationProfile | null;
  contractSuite: ContractSuite | null;
  testScenarios: readonly TestScenario[];
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

export function testDesignFingerprint(source: TestDesignSource): string {
  return fingerprint({
    boundaryRevisionId: source.boundaryDesign?.revisionId,
    profileRevisionId: source.implementationProfile?.revisionId,
    contractSuiteRevisionId: source.contractSuite?.revisionId,
    scenarios: scenarioDesign(source.testScenarios),
  });
}

class StoreEventEmitter {
  private readonly listeners = new Set<(step: WorkflowStage) => void>();

  emit(_event: "stepUpdate", step: WorkflowStage): void {
    this.listeners.forEach((listener) => listener(step));
  }

  on(_event: "stepUpdate", listener: (step: WorkflowStage) => void): void {
    this.listeners.add(listener);
  }

  off(_event: "stepUpdate", listener: (step: WorkflowStage) => void): void {
    this.listeners.delete(listener);
  }
}

/**
 * A rate-limited or timed-out attempt, as the store action call that
 * repeats it. Data rather than a closure, so a replica can show that a
 * retry is waiting.
 */
export interface PendingRetry {
  action: string;
  args: unknown[];
}

/**
 * The volatile state the interface reads. It never enters a snapshot or a
 * patch, so the authority sends it to replicas separately; every other
 * volatile field is either derived on each side (module context) or
 * machinery only the authority uses (abort handles).
 */
export interface ReplicatedVolatileState {
  validationErrorDetails: string | null;
  providerCalls: ProviderCallRecord[];
  pendingImpactChange: PendingImpactChange | null;
  contractRevisionDiff: string | null;
  thinkingLabel: string | null;
  thinkingText: string;
  pendingRetry: PendingRetry | null;
}

const REPLICATED_VOLATILE_KEYS = [
  "validationErrorDetails",
  "providerCalls",
  "pendingImpactChange",
  "contractRevisionDiff",
  "thinkingLabel",
  "thinkingText",
  "pendingRetry",
] as const satisfies readonly (keyof ReplicatedVolatileState)[];

export const ScaffoldFileModel = types.model({
  path: types.refinement("SafeVirtualFilePath", types.string, isSafeVirtualPath),
  content: types.string,
});

/** The slice of a store another module needs to resolve a reference. */
export interface FragmentLookupStore {
  getCode(id: string): string | undefined;
  getPath(id: string): string | undefined;
}

export interface SiblingModuleReference {
  id: string;
  store: FragmentLookupStore;
}

function findSiblingModule(
  store: { siblingModules: readonly SiblingModuleReference[] },
  id: string,
): SiblingModuleReference | undefined {
  return store.siblingModules.find((module) => module.store.getCode(id) != null);
}

export const FlatStore = types
  .model("Store", {
    schemaVersion: types.optional(types.literal(MODULE_SCHEMA_VERSION), MODULE_SCHEMA_VERSION),
    isClean: types.optional(types.boolean, true),
    businessCounter: types.optional(types.number, 0),
    validationErrors: types.maybeNull(types.string),
    productOverview: ProductOverviewModel,
    // One-time starting intent that drafted the overview. Revision 0
    // provenance: write-once, read-only, never an input to generation.
    overviewSeed: types.optional(types.maybeNull(types.string), null),
    userStories: types.array(UserStoryModel),
    requirements: types.array(RequirementModel),
    acceptanceCriteria: types.array(AcceptanceCriteriaModel),
    boundaryDesign: types.maybeNull(types.frozen<BoundaryDesign>()),
    implementationProfile: types.maybeNull(types.frozen<ImplementationProfile>()),
    contractSuite: types.maybeNull(types.frozen<ContractSuite>()),
    testScenarios: types.array(TestScenarioModel),
    projectSetup: types.maybeNull(types.frozen<ProjectSetup>()),
    scaffoldFiles: types.array(ScaffoldFileModel),
    review: types.optional(types.frozen<ReviewBook>(), EMPTY_REVIEW_BOOK),
    threads: types.optional(types.frozen<ReviewThread[]>(), []),
    stageListChanges: types.map(types.frozen<ListChange>()),
    systemMessage: types.maybeNull(types.string),
    conversation: types.optional(types.frozen<unknown[]>(), []),
    conversationSidebarOpen: false,
  })
  .volatile((): ReplicatedVolatileState & {
    moduleMode: boolean;
    siblingModules: SiblingModuleReference[];
    aiAbortController: AbortController | null;
    activeAgent: { abort(): void } | null;
  } => ({
    /** Module-mode copy follows this flag; volatile, never part of a snapshot. */
    moduleMode: false,
    /** Sibling modules of the open project, for display-level reference resolution. */
    siblingModules: [],
    validationErrorDetails: null,
    providerCalls: [],
    pendingImpactChange: null,
    contractRevisionDiff: null,
    thinkingLabel: null,
    thinkingText: "",
    pendingRetry: null,
    aiAbortController: null,
    activeAgent: null,
  }))
  .views(() => {
    const eventTarget = new StoreEventEmitter();
    return { get eventTarget() { return eventTarget; } };
  })
  .actions((self) => ({
    setModuleContext({ moduleMode }: { moduleMode: boolean }) {
      if (self.moduleMode === moduleMode) return;
      self.moduleMode = moduleMode;
    },
    setSiblingModules(references: SiblingModuleReference[]) {
      const current = self.siblingModules;
      const unchanged =
        current.length === references.length &&
        current.every(
          (reference, index) =>
            reference.id === references[index].id &&
            reference.store === references[index].store,
        );
      if (unchanged) return;
      self.siblingModules = references;
    },
    reset() {
      self.isClean = true;
      self.businessCounter = 0;
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
      self.review = EMPTY_REVIEW_BOOK;
      self.threads = [];
      self.stageListChanges.clear();
      self.systemMessage = null;
      self.pendingImpactChange = null;
      self.contractRevisionDiff = null;
      self.thinkingLabel = null;
      self.thinkingText = "";
      self.pendingRetry = null;
      self.aiAbortController = null;
      self.activeAgent = null;
      self.conversation = cast([]);
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
    /** Take the stored calls, keeping any recorded since they were read. */
    hydrateProviderCalls(stored: ProviderCallRecord[]) {
      self.providerCalls = mergeProviderCalls(
        stored,
        self.providerCalls,
        MAX_PROVIDER_CALL_HISTORY,
      );
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
      self.conversation = cast(hydrateConversationThinking(messages));
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
    /** Replica only: take the authority's replicated volatile values. */
    mirrorVolatileState(values: Partial<ReplicatedVolatileState>) {
      Object.assign(self, values);
    },
  }))
  .actions((self) => ({
    initialize(info: ProductOverviewProposal) {
      const toSnapshot = (item: ProductOverviewPatchItem): SnapshotIn<PrimaryFeature | TargetUser> => {
        const content = typeof item === "string" ? item : item.content;
        // Bare string here is new content only during initial creation (no existing ids to keep);
        // patch paths with existing ids are handled in applyProductOverviewProposal, not here.
        return { content } as SnapshotIn<PrimaryFeature | TargetUser>;
      };
      self.productOverview = ProductOverviewModel.create({
        purpose: info.purpose,
        primaryFeatures: info.primaryFeatures.map(toSnapshot) as SnapshotIn<PrimaryFeature>[],
        targetUsers: info.targetUsers.map(toSnapshot) as SnapshotIn<TargetUser>[],
      });
      self.eventTarget.emit("stepUpdate", WorkflowStage.ProductOverview);
    },
    recordStageListChange(step: WorkflowStage, change: ListChange) {
      self.stageListChanges.set(step, change);
    },
    removeEarlyFragment(fragment: StructuralFragment) {
      switch (fragment.type) {
        case StructuralFragmentName.PrimaryFeature:
          self.productOverview.removePrimaryFeature({
            fragment: fragment as PrimaryFeature,
          });
          return;
        case StructuralFragmentName.TargetUser:
          self.productOverview.removeTargetUser({
            fragment: fragment as TargetUser,
          });
          return;
        case StructuralFragmentName.UserStory:
          self.userStories.remove(fragment as UserStory);
          return;
        case StructuralFragmentName.Requirement:
          self.requirements.remove(fragment as Requirement);
          return;
        case StructuralFragmentName.AcceptanceCriteria:
          self.acceptanceCriteria.remove(fragment as AcceptanceCriteria);
          return;
        default:
          throw new Error(`Cannot drop ${fragment.type} fragment ${fragment.id}.`);
      }
    },
    setPurpose({ purpose }: { purpose: string }) {
      self.productOverview.purpose = purpose;
    },
    // Revision 0 provenance is one-time: later generates never overwrite it.
    setOverviewSeed({ seed }: { seed: string }) {
      if (self.overviewSeed != null) return;
      self.overviewSeed = seed;
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
    setImplementationProfile(profile: ImplementationProfile) {
      self.implementationProfile = cast(profile);
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
          signature: scenario.signature ?? null,
          verdict: scenario.verdict ?? null,
          basis: scenario.basis,
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
          signature: testCase.signature ?? null,
          verdict: testCase.verdict ?? null,
          basis: testCase.basis,
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
  .views((self) => ({
    /**
     * The one display label for a workflow stage: in module mode the
     * product-facing name of the first stage names the module's overview.
     */
    stageLabel(step: WorkflowStage): string {
      if (self.moduleMode && step === WorkflowStage.ProductOverview) {
        return "Module Overview";
      }
      return WORKFLOW_STAGE_LABELS[step];
    },
    get rootSubjectLabel(): string {
      return self.moduleMode ? "root module" : "root product";
    },
    get isBusy() {
      return self.businessCounter > 0;
    },
    get testCases() {
      return self.testScenarios.flatMap((scenario) => scenario.testCases);
    },
    get hasGeneratedScaffold() {
      return hasGeneratedScaffoldIn(self.projectSetup, self.scaffoldFiles.length);
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
    data(step: WorkflowStage = LAST_WORKFLOW_STAGE, includeBuildArtifacts = false) {
      return {
        schemaVersion: MODULE_SCHEMA_VERSION,
        ...(!isBefore(step, WorkflowStage.ProductOverview)
          ? { productOverview: self.productOverview }
          : {}),
        ...(!isBefore(step, WorkflowStage.UserStories) ? { userStories: self.userStories } : {}),
        ...(!isBefore(step, WorkflowStage.Requirements) ? { requirements: self.requirements } : {}),
        ...(!isBefore(step, WorkflowStage.AcceptanceCriteria)
          ? { acceptanceCriteria: self.acceptanceCriteria }
          : {}),
        ...(!isBefore(step, WorkflowStage.BoundaryDesign)
          ? { boundaryDesign: self.boundaryDesign }
          : {}),
        ...(!isBefore(step, WorkflowStage.InterfaceContracts)
          ? {
              implementationProfile: self.implementationProfile,
              contractSuite: self.contractSuite,
            }
          : {}),
        ...(!isBefore(step, WorkflowStage.TestScenarios)
          ? { testScenarios: self.testScenarios }
          : {}),
        ...(includeBuildArtifacts
          ? {
              projectSetup: self.projectSetup,
              scaffoldFiles: self.scaffoldFiles,
              review: self.review,
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
    get integrityGraph(): IntegrityGraph {
      return integrityGraphFromStore(self);
    },
    get mechanicalIssues(): MechanicalIssue[] {
      return collectMechanicalIssues(integrityGraphFromStore(self));
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
    /**
     * Cross-module references resolve at display level only: a code
     * belongs to its module, so a miss falls through to the sibling
     * modules while every workflow decision stays on the active one.
     */
    getCode(id: string) {
      const own = self.structuralFragmentsCache[id]?.getCode();
      if (own != null) return own;
      return findSiblingModule(self, id)?.store.getCode(id);
    },
    getPath(id: string) {
      const fragment = self.structuralFragmentsCache[id];
      if (fragment != null) {
        return `?step=${WORKFLOW_STAGE_BY_STRUCTURAL_FRAGMENT[fragment.type]}#${fragment.id}`;
      }
      const sibling = findSiblingModule(self, id);
      const siblingPath = sibling?.store.getPath(id);
      if (sibling == null || siblingPath == null) return undefined;
      return `?module=${sibling.id}&${siblingPath.slice(1)}`;
    },
    get isProjectSetupOutdated() {
      return self.projectSetup != null && !self.projectSetupIsCurrent;
    },
    stageListChange(step: WorkflowStage): ListChange | undefined {
      return self.stageListChanges.get(step);
    },
    stageListChangeCaption(step: WorkflowStage) {
      const change = self.stageListChanges.get(step);
      if (change == null) return null;
      return listChangeCaption(change);
    },
  }))
  .views((self) => {
    // ---------------------------------------------------------------
    // The review gate: every reviewable unit's revision, checked hash,
    // outdated state, and approval are derived here and only here.
    // ---------------------------------------------------------------
    const contractBundle = (id: string) => {
      const suite = self.contractSuite;
      if (suite == null) return null;
      return (
        suite.interfaceContracts.find((item) => item.id === id) ??
        suite.subjectContracts.find((item) => item.id === id) ??
        suite.verificationContracts.find((item) => item.id === id) ??
        null
      );
    };
    const fragmentOf = (id: string): StructuralFragment | undefined =>
      self.structuralFragmentsCache[id];
    const isTestFragment = (fragment: StructuralFragment) =>
      fragment.type === StructuralFragmentName.TestScenario ||
      fragment.type === StructuralFragmentName.TestCase;

    /** The current revision of any unit an item can reference. */
    function revisionOf(id: string): string | null {
      if (id === OVERVIEW_PURPOSE_QUALITY_ID) {
        return checkedHash({ purpose: self.productOverview.purpose });
      }
      const fragment = fragmentOf(id);
      if (fragment != null) {
        return isTestFragment(fragment)
          ? (fragment as unknown as { revisionId: string }).revisionId
          : proseRevision(fragment);
      }
      if (self.boundaryDesign?.id === id) return self.boundaryDesign.revisionId;
      if (self.implementationProfile?.id === id) return self.implementationProfile.revisionId;
      if (self.projectSetup?.id === id) return self.projectSetup.revisionId;
      return contractBundle(id)?.revisionId ?? null;
    }

    /** The units an item was generated against: its references, plus the contracts a scenario binds. */
    function referencedUnitIds(fragment: {
      type: StructuralFragmentName;
      references: readonly { id: string }[];
      binding?: TestScenarioBinding | null;
    }): string[] {
      const ids = fragment.references.map(({ id }) => id);
      const binding = fragment.binding;
      if (fragment.type !== StructuralFragmentName.TestScenario || binding == null) {
        return ids;
      }
      const suite = self.contractSuite;
      if (self.boundaryDesign != null) ids.push(self.boundaryDesign.id);
      if (binding.kind === "verification") {
        const contract = suite?.verificationContracts.find(
          (item) => item.verificationObligationId === binding.verificationObligationId,
        );
        if (contract != null) ids.push(contract.id);
        return ids;
      }
      for (const interfaceId of binding.interfaceIds) {
        const contract = suite?.interfaceContracts.find(
          (item) => item.interfaceId === interfaceId,
        );
        if (contract != null) ids.push(contract.id);
      }
      const subject = suite?.subjectContracts.find(
        (item) => item.subjectId === binding.subjectId,
      );
      if (subject != null) ids.push(subject.id);
      return ids;
    }

    function currentBasisOf(fragment: Parameters<typeof referencedUnitIds>[0]): Record<string, string> {
      return Object.fromEntries(
        referencedUnitIds(fragment).map((id) => [id, revisionOf(id) ?? MISSING_REVISION]),
      );
    }

    function fragmentIsOutdated(fragment: StructuralFragment): boolean {
      const basis = fragment.basis;
      if (basis == null) return true;
      const current = currentBasisOf(fragment as never);
      const keys = Object.keys(current);
      if (keys.length !== Object.keys(basis).length) return true;
      if (keys.some((key) => basis[key] !== current[key])) return true;
      if (fragment.type === StructuralFragmentName.TestScenario) {
        const binding = (fragment as TestScenario).binding;
        return binding != null && !scenarioBindingIsCurrent(binding);
      }
      if (fragment.type === StructuralFragmentName.TestCase) {
        const definition = (fragment as TestCase).definition;
        return definition != null && !caseDefinitionIsCurrent(definition);
      }
      return false;
    }

    function scenarioBindingIsCurrent(binding: TestScenarioBinding): boolean {
      const suite = self.contractSuite;
      if (self.boundaryDesign == null || suite == null) return false;
      if (binding.boundaryRevisionId !== self.boundaryDesign.revisionId) return false;
      if (binding.kind === "verification") {
        return suite.verificationContracts.some(
          ({ revisionId }) => revisionId === binding.verificationContractRevisionId,
        );
      }
      const interfaceRevisions = new Set(
        suite.interfaceContracts.map(({ revisionId }) => revisionId),
      );
      return (
        binding.interfaceContractRevisionIds.every((id) => interfaceRevisions.has(id)) &&
        suite.subjectContracts.some(
          ({ revisionId }) => revisionId === binding.subjectContractRevisionId,
        )
      );
    }

    function caseDefinitionIsCurrent(definition: TestCaseDefinition): boolean {
      const suite = self.contractSuite;
      if (self.boundaryDesign == null || suite == null) return false;
      if (definition.kind === "verification") {
        return suite.verificationContracts.some(
          ({ revisionId }) => revisionId === definition.verificationContractRevisionId,
        );
      }
      const interfaceRevisions = new Set(
        suite.interfaceContracts.map(({ revisionId }) => revisionId),
      );
      return (
        definition.boundaryRevisionId === self.boundaryDesign.revisionId &&
        definition.interfaceContractRevisionIds.every((id) => interfaceRevisions.has(id)) &&
        suite.subjectContracts.some(
          ({ revisionId }) => revisionId === definition.subjectContractRevisionId,
        )
      );
    }

    /** What a reviewer reads and a restore writes back, per unit kind. */
    function fragmentContent(fragment: StructuralFragment): JsonValue {
      if (fragment.type === StructuralFragmentName.TestScenario) {
        const scenario = fragment as TestScenario;
        return {
          title: scenario.content,
          description: scenario.description,
          references: scenario.references.map(({ id, type }) => ({ id, type })),
          dependencies: [...scenario.dependencies],
          binding: (scenario.binding ?? null) as JsonValue,
          revisionId: scenario.revisionId,
        };
      }
      if (fragment.type === StructuralFragmentName.TestCase) {
        const testCase = fragment as TestCase;
        return {
          title: testCase.title,
          description: testCase.description,
          references: testCase.references.map(({ id, type }) => ({ id, type })),
          dependencies: [...testCase.dependencies],
          definition: (testCase.definition ?? null) as JsonValue,
          revisionId: testCase.revisionId,
        };
      }
      return {
        content: fragment.content,
        references: fragment.references.map(({ id, type }) => ({ id, type })),
        dependencies: [...fragment.dependencies],
      };
    }

    function artifactIsOutdated(id: string): boolean {
      const design = self.boundaryDesign;
      const profile = self.implementationProfile;
      if (design?.id === id) {
        return (
          design.requirementsRevisionId !== itemSetRevision(self.requirements) ||
          design.acceptanceCriteriaRevisionId !== itemSetRevision(self.acceptanceCriteria)
        );
      }
      if (profile?.id === id) return profile.boundaryRevisionId !== design?.revisionId;
      if (self.projectSetup?.id === id) return !self.projectSetupIsCurrent;
      const suite = self.contractSuite;
      const bundle = contractBundle(id);
      if (bundle == null || suite == null) return false;
      if (
        bundle.boundaryRevisionId !== design?.revisionId ||
        bundle.profileRevisionId !== profile?.revisionId
      ) {
        return true;
      }
      if ("interfaceContractRevisionIds" in bundle) {
        const current = new Set(suite.interfaceContracts.map(({ revisionId }) => revisionId));
        return bundle.interfaceContractRevisionIds.some((revisionId) => !current.has(revisionId));
      }
      return false;
    }

    // ---- Units ------------------------------------------------------

    const LIST_STAGE_ITEMS: Partial<Record<WorkflowStage, () => readonly StructuralFragment[]>> = {
      [WorkflowStage.UserStories]: () => self.userStories,
      [WorkflowStage.Requirements]: () => self.requirements,
      [WorkflowStage.AcceptanceCriteria]: () => self.acceptanceCriteria,
      [WorkflowStage.TestScenarios]: () => self.testScenarios as unknown as StructuralFragment[],
      [WorkflowStage.TestCases]: () =>
        self.testScenarios.flatMap((scenario) => scenario.testCases) as unknown as StructuralFragment[],
    };

    /** The item-level units of a stage: what later stages consume. */
    function itemUnitIds(step: WorkflowStage): string[] {
      switch (step) {
        case WorkflowStage.ProductOverview:
          return [
            OVERVIEW_PURPOSE_QUALITY_ID,
            ...self.productOverview.primaryFeatures.map(({ id }) => id),
            ...self.productOverview.targetUsers.map(({ id }) => id),
          ];
        case WorkflowStage.BoundaryDesign:
          return self.boundaryDesign == null ? [] : [self.boundaryDesign.id];
        case WorkflowStage.InterfaceContracts:
          return [
            ...(self.implementationProfile == null ? [] : [self.implementationProfile.id]),
            ...(self.contractSuite?.interfaceContracts.map(({ id }) => id) ?? []),
            ...(self.contractSuite?.subjectContracts.map(({ id }) => id) ?? []),
            ...(self.contractSuite?.verificationContracts.map(({ id }) => id) ?? []),
          ];
        case WorkflowStage.ProjectSetup:
          return self.projectSetup == null ? [] : [self.projectSetup.id];
        case WorkflowStage.AutomatedTests:
        case WorkflowStage.Code:
          return [];
        default:
          return (LIST_STAGE_ITEMS[step]?.() ?? []).map(({ id }) => id);
      }
    }

    /** A unit's content as a later stage sees it: prose in full, formal artifacts by revision. */
    function inputContentOf(id: string): JsonValue {
      if (id === OVERVIEW_PURPOSE_QUALITY_ID) return { purpose: self.productOverview.purpose };
      const fragment = fragmentOf(id);
      if (fragment != null) return fragmentContent(fragment);
      return { revisionId: revisionOf(id) };
    }

    function currentInputs(step: WorkflowStage): Record<string, JsonValue> {
      return Object.fromEntries(
        (STAGE_INPUTS[step] ?? []).flatMap((input) =>
          itemUnitIds(input).map((id) => [id, inputContentOf(id)] as const),
        ),
      );
    }

    /** Inputs whose content differs from what the stage last acknowledged. */
    function changedInputIds(step: WorkflowStage): string[] {
      const acknowledged = self.review.acknowledgedInputs[step];
      if (acknowledged == null) return [];
      const current = currentInputs(step);
      const ids = new Set([...Object.keys(acknowledged), ...Object.keys(current)]);
      return [...ids]
        .filter((id) =>
          acknowledged[id] === undefined ||
          current[id] === undefined ||
          checkedHash(acknowledged[id]) !== checkedHash(current[id]),
        )
        .sort();
    }

    function liveItems(step: WorkflowStage): readonly StructuralFragment[] {
      return (LIST_STAGE_ITEMS[step]?.() ?? []).filter(({ pendingRemoval }) => !pendingRemoval);
    }

    function inputsHash(step: WorkflowStage): string {
      return checkedHash(currentInputs(step));
    }

    /**
     * Approved items an upstream change did not reach through their
     * references, approved before the inputs changed: what impact review
     * confirms. Drafts are reviewed one by one against the current inputs.
     */
    function untouchedItems(step: WorkflowStage): StructuralFragment[] {
      const changed = new Set(changedInputIds(step));
      if (changed.size === 0) return [];
      const current = inputsHash(step);
      return liveItems(step).filter((item) => {
        const unit = reviewUnit(item.id);
        if (unit?.approved !== true || unit.signature!.inputs === current) return false;
        return referencedUnitIds(item as never).every((id) => !changed.has(id));
      });
    }

    function impactIsPending(step: WorkflowStage): boolean {
      return IMPACT_STAGES.has(step) && untouchedItems(step).length > 0;
    }

    function impactChecked(step: WorkflowStage): string {
      const current = currentInputs(step);
      return checkedHash({
        changes: changedInputIds(step).map((id) => [id, current[id] === undefined ? null : checkedHash(current[id])]),
        items: revisionListing(untouchedItems(step).map((item) => [item.id, revisionOf(item.id)!] as const)),
      });
    }

    function coverageParents(step: WorkflowStage): StructuralFragment[] {
      switch (step) {
        case WorkflowStage.UserStories:
          return [...self.productOverview.primaryFeatures];
        case WorkflowStage.Requirements:
          return [...self.userStories];
        case WorkflowStage.AcceptanceCriteria:
          return [...self.requirements];
        default:
          return [];
      }
    }

    function coverageStageOf(parentId: string): WorkflowStage | null {
      const parent = fragmentOf(parentId);
      if (parent == null) return null;
      return COVERAGE_STAGE_BY_PARENT_TYPE[parent.type] ?? null;
    }

    function coverageChildren(parentId: string): StructuralFragment[] {
      const step = coverageStageOf(parentId);
      if (step == null) return [];
      return liveItems(step).filter((item) =>
        item.references.some(({ id }) => id === parentId),
      );
    }

    function coverageChecked(parentId: string): string {
      return checkedHash({
        parent: [parentId, revisionOf(parentId)],
        children: revisionListing(
          coverageChildren(parentId).map((child) => [child.id, revisionOf(child.id)!] as const),
        ),
      });
    }

    function standalone(id: string): StandaloneReview {
      return self.review.units[id] ?? { signature: null, verdict: null };
    }

    /** The one place a unit's review state is assembled. */
    function reviewUnit(id: string): ReviewUnit | null {
      const finish = (
        unit: Omit<ReviewUnit, "approved">,
      ): ReviewUnit => ({
        ...unit,
        approved: holds(unit.signature, unit.checked) && !unit.outdated && !unit.pendingRemoval,
      });
      if (id === OVERVIEW_PURPOSE_QUALITY_ID) {
        const overview = self.productOverview;
        const content = inputContentOf(id);
        return finish({
          id,
          stage: WorkflowStage.ProductOverview,
          kind: "field",
          checked: revisionOf(id)!,
          content,
          outdated: false,
          pendingRemoval: false,
          signature: overview.purposeSignature,
          verdict: overview.purposeVerdict,
        });
      }
      const coverageParent = coverageParentId(id);
      if (coverageParent != null) {
        const step = coverageStageOf(coverageParent);
        if (step == null) return null;
        const record = standalone(id);
        return finish({
          id,
          stage: step,
          kind: "coverage",
          checked: coverageChecked(coverageParent),
          content: {
            parent: inputContentOf(coverageParent),
            children: coverageChildren(coverageParent).map((child) => ({
              id: child.id,
              ...(fragmentContent(child) as Record<string, JsonValue>),
            })),
          },
          outdated: false,
          pendingRemoval: false,
          signature: record.signature,
          verdict: record.verdict,
        });
      }
      const impact = impactStage(id);
      if (impact != null) {
        if (!impactIsPending(impact)) return null;
        const record = standalone(id);
        const acknowledged = self.review.acknowledgedInputs[impact] ?? {};
        const current = currentInputs(impact);
        return finish({
          id,
          stage: impact,
          kind: "impact",
          checked: impactChecked(impact),
          content: {
            changes: changedInputIds(impact).map((changedId) => ({
              id: changedId,
              before: acknowledged[changedId] ?? null,
              after: current[changedId] ?? null,
            })),
            items: untouchedItems(impact).map((item) => ({
              id: item.id,
              ...(fragmentContent(item) as Record<string, JsonValue>),
            })),
          },
          outdated: false,
          pendingRemoval: false,
          signature: record.signature,
          verdict: record.verdict,
        });
      }
      const fragment = fragmentOf(id);
      if (fragment != null) {
        return finish({
          id,
          stage: WORKFLOW_STAGE_BY_STRUCTURAL_FRAGMENT[fragment.type],
          kind: "item",
          checked: checkedHash({ revision: revisionOf(id), basis: fragment.basis }),
          content: fragmentContent(fragment),
          // Approving a removal never depends on the removed content being current.
          outdated: !fragment.pendingRemoval && fragmentIsOutdated(fragment),
          pendingRemoval: fragment.pendingRemoval,
          signature: fragment.signature,
          verdict: fragment.verdict,
        });
      }
      const artifact =
        self.boundaryDesign?.id === id ? self.boundaryDesign
          : self.implementationProfile?.id === id ? self.implementationProfile
            : self.projectSetup?.id === id ? self.projectSetup
              : contractBundle(id);
      if (artifact == null) return null;
      const { signature: _signature, verdict: _verdict, ...content } = artifact as unknown as RevisionMetadata & Record<string, unknown>;
      return finish({
        id,
        stage: self.boundaryDesign?.id === id
          ? WorkflowStage.BoundaryDesign
          : self.projectSetup?.id === id
            ? WorkflowStage.ProjectSetup
            : WorkflowStage.InterfaceContracts,
        kind: "artifact",
        checked: checkedHash(content),
        content: content as JsonValue,
        outdated: artifactIsOutdated(id),
        pendingRemoval: false,
        signature: artifact.signature ?? null,
        verdict: artifact.verdict ?? null,
      });
    }

    function stageUnitIds(step: WorkflowStage): string[] {
      const ids = itemUnitIds(step);
      if (COVERAGE_STAGES.has(step)) {
        ids.push(...coverageParents(step).map(({ id }) => coverageUnitId(id)));
      }
      if (impactIsPending(step)) ids.push(impactUnitId(step));
      return ids;
    }

    function stageUnits(step: WorkflowStage): ReviewUnit[] {
      return stageUnitIds(step)
        .map(reviewUnit)
        .filter((unit): unit is ReviewUnit => unit != null);
    }

    // ---- Progress ---------------------------------------------------

    function stageIssues(step: WorkflowStage) {
      return self.mechanicalIssues.filter((issue) => issue.stage === step);
    }

    function hasStepArtifacts(step: WorkflowStage): boolean {
      switch (step) {
        case WorkflowStage.ProductOverview:
          return !self.productOverview.isEmpty;
        case WorkflowStage.UserStories:
          return self.userStories.length > 0;
        case WorkflowStage.Requirements:
          return self.requirements.length > 0;
        case WorkflowStage.AcceptanceCriteria:
          return self.acceptanceCriteria.length > 0;
        case WorkflowStage.BoundaryDesign:
          return self.boundaryDesign != null;
        case WorkflowStage.InterfaceContracts:
          return self.implementationProfile != null || self.contractSuite != null;
        case WorkflowStage.TestScenarios:
          return self.testScenarios.length > 0;
        case WorkflowStage.TestCases:
          return self.testScenarios.some(({ testCases }) => testCases.length > 0);
        case WorkflowStage.ProjectSetup:
          return self.projectSetup != null;
        case WorkflowStage.AutomatedTests:
          return self.testScenarios.some((scenario) =>
            scenario.testCases.some(
              ({ generatedInputFingerprint }) => generatedInputFingerprint != null,
            ),
          );
        case WorkflowStage.Code:
          return false;
      }
    }

    /** The stage's completion rule, apart from approvals. */
    function completionRuleHolds(step: WorkflowStage): boolean {
      const clean = stageIssues(step).length === 0;
      switch (step) {
        case WorkflowStage.ProductOverview:
          return self.productOverview.isComplete && clean;
        case WorkflowStage.UserStories:
        case WorkflowStage.Requirements:
        case WorkflowStage.AcceptanceCriteria:
        case WorkflowStage.BoundaryDesign:
          return hasStepArtifacts(step) && clean;
        case WorkflowStage.InterfaceContracts:
          return self.contractsReady;
        case WorkflowStage.TestScenarios:
          return (
            self.testScenarios.length > 0 &&
            self.testScenarios.every(({ binding }) => binding != null) &&
            clean
          );
        case WorkflowStage.TestCases:
          return (
            self.testScenarios.length > 0 &&
            self.testScenarios.every(
              (scenario) =>
                scenario.testCases.length > 0 &&
                scenario.testCases.every(({ definition }) => definition != null),
            ) &&
            clean
          );
        case WorkflowStage.ProjectSetup:
          return self.projectSetup != null;
        case WorkflowStage.AutomatedTests: {
          const cases = self.testScenarios.flatMap((scenario) => [...scenario.testCases]);
          return (
            self.projectSetup != null &&
            self.projectSetupIsCurrent &&
            cases.length > 0 &&
            cases.every(({ testStatus }) => testStatus === "generated")
          );
        }
        case WorkflowStage.Code:
          return false;
      }
    }

    function stageIsComplete(step: WorkflowStage): boolean {
      return completionRuleHolds(step) && stageUnits(step).every(({ approved }) => approved);
    }

    return {
      revisionOf,
      currentBasisOf,
      scenarioBindingIsCurrent,
      caseDefinitionIsCurrent,
      reviewUnit,
      stageUnits,
      stageUnitIds,
      itemUnitIds,
      currentInputs,
      inputsHash,
      changedInputIds,
      /** Each changed input of a stage, with its content before and after. */
      inputChanges(step: WorkflowStage): { id: string; code: string | null; before: JsonValue; after: JsonValue }[] {
        const acknowledged = self.review.acknowledgedInputs[step] ?? {};
        const current = currentInputs(step);
        return changedInputIds(step).map((id) => ({
          id,
          code: self.getCode(id) ?? null,
          before: acknowledged[id] ?? null,
          after: current[id] ?? null,
        }));
      },
      untouchedItemIds(step: WorkflowStage): string[] {
        return untouchedItems(step).map(({ id }) => id);
      },
      coverageChildIds(parentId: string): string[] {
        return coverageChildren(parentId).map(({ id }) => id);
      },
      coverageParentIds(step: WorkflowStage): string[] {
        return COVERAGE_STAGES.has(step) ? coverageParents(step).map(({ id }) => id) : [];
      },
      outdatedItemIds(step: WorkflowStage): string[] {
        return stageUnits(step)
          .filter(({ outdated }) => outdated)
          .map(({ id }) => id);
      },
      hasStepArtifacts,
      completionRuleHolds,
      stageIsComplete,
      /** Each unit's review state up to a stage, as an agent reads it beside the stored signatures. */
      reviewStatuses(step: WorkflowStage): ReviewStatus[] {
        return PROGRESS_STAGES.filter((stage) => !isBefore(step, stage)).flatMap((stage) =>
          stageUnits(stage).map((unit) => ({ id: unit.id, stage, kind: unit.kind, status: reviewStatusOf(unit) })),
        );
      },
      laterStagesHoldingWork(step: WorkflowStage | null): WorkflowStage[] {
        const start = step == null ? WORKFLOW_STAGES.length : WORKFLOW_STAGES.indexOf(step) + 1;
        return WORKFLOW_STAGES.slice(start).filter(
          (later) => later !== WorkflowStage.Code && hasStepArtifacts(later),
        );
      },
      mechanicalIssuesForStage(step: WorkflowStage): MechanicalIssue[] {
        return stageIssues(step);
      },
      mechanicalIssuesForItem(id: string): MechanicalIssue[] {
        return self.mechanicalIssues.filter((issue) => issue.itemId === id);
      },
      reviewModeOf(step: WorkflowStage): ReviewMode {
        return self.review.modes[step] ?? "manual";
      },
    };
  })
  .views((self) => ({
    /** The first stage that is not complete; null when the project is complete. */
    get frontier(): WorkflowStage | null {
      return PROGRESS_STAGES.find((step) => !self.stageIsComplete(step)) ?? null;
    },
  }))
  .views((self) => {
    /** Whether the stage can change at all: the frontier and everything before it. */
    function stageIsEditable(step: WorkflowStage): boolean {
      if (step === WorkflowStage.Code) return false;
      return self.frontier == null || !isAfter(step, self.frontier);
    }
    function getStepStatus(step: WorkflowStage): Status {
      if (step === WorkflowStage.Code) return Status.Pending;
      const current = self.frontier;
      if (current == null || isBefore(step, current)) return Status.Completed;
      if (step !== current) {
        return self.hasStepArtifacts(step) ? Status.Waiting : Status.Locked;
      }
      if (!self.hasStepArtifacts(step)) return Status.Pending;
      if (self.stageUnits(step).some(({ outdated }) => outdated)) return Status.Outdated;
      if (!self.completionRuleHolds(step)) return Status.Pending;
      return Status.NeedsApproval;
    }
    return {
      get isComplete(): boolean {
        return self.frontier == null;
      },
      getStepStatus,
      stageIsEditable,
      /** Why nothing may happen in a stage after the frontier, phrased as the next action. */
      stageBlockerReason(step: WorkflowStage, tail: string): string | null {
        if (stageIsEditable(step)) return null;
        const blocker = self.frontier!;
        const label = self.stageLabel(blocker);
        if (self.outdatedItemIds(blocker).length > 0) {
          return `Outdated ${label}. ${refreshGuidance(blocker, label)} ${tail}.`;
        }
        return `Complete ${label} ${tail}.`;
      },
      stageIsLocked(step: WorkflowStage): boolean {
        return getStepStatus(step) === Status.Locked;
      },
      resolveOpenStep(step: WorkflowStage): WorkflowStage {
        if (getStepStatus(step) !== Status.Locked) return step;
        return self.frontier ?? WorkflowStage.ProductOverview;
      },
    };
  })
  .views((self) => {
    function approvalOf(id: string): ApprovalStatus | null {
      const unit = self.reviewUnit(id);
      if (unit == null) return null;
      return unit.approved ? "approved" : "draft";
    }
    function cannotGenerateReason(step: WorkflowStage): string | null {
      if (GENERATOR_ACTION_BY_WORKFLOW_STAGE[step] == null) {
        return "This stage has no generate action.";
      }
      const reason = self.stageBlockerReason(step, `to generate ${self.stageLabel(step)}`);
      if (reason != null) return reason;
      if (
        step === WorkflowStage.InterfaceContracts &&
        self.implementationProfile != null &&
        approvalOf(self.implementationProfile.id) !== "approved"
      ) {
        return "Approve the implementation profile to generate Interface Contracts.";
      }
      return null;
    }
    /** Whether the unit can be approved now, by anyone; a person's click also waits for idle. */
    function isApprovable(id: string): boolean {
      const unit = self.reviewUnit(id);
      if (unit == null || unit.approved || unit.outdated) return false;
      if (!self.stageIsEditable(unit.stage)) return false;
      switch (unit.kind) {
        case "field":
          return Object.values(unit.content as Record<string, string | null>)
            .some((value) => (value?.trim().length ?? 0) > 0);
        case "item": {
          if (unit.pendingRemoval) return true;
          const fragment = self.structuralFragmentsCache[id];
          return fragment != null && fragment.content.trim().length > 0;
        }
        case "coverage":
          return self.coverageChildIds(coverageParentId(id)!).length > 0;
        case "impact":
          return self.outdatedItemIds(unit.stage).length === 0;
        case "artifact":
          return true;
      }
    }
    function currentVerdictOf(id: string): ModelVerdict | null {
      const unit = self.reviewUnit(id);
      if (unit == null || !holds(unit.verdict, unit.checked)) return null;
      return unit.verdict;
    }
    return {
      /** Draft, approved, or null for an id that names no reviewable unit. */
      approvalOf,
      /** The model verdict on the unit's current state, if any. */
      currentVerdictOf,
      cannotGenerateReason,
      canGenerateStep(step: WorkflowStage): boolean {
        return cannotGenerateReason(step) == null;
      },
      stageIsApproved(step: WorkflowStage): boolean {
        return self.stageIsComplete(step);
      },
      /** The signed text a draft shows its standing diff against. */
      signedTextOf(id: string): string | null {
        const unit = self.reviewUnit(id);
        if (unit == null || unit.approved || unit.signature?.signed == null) return null;
        return signedText(unit.signature.signed, self.structuralFragmentsCache[id]?.type ?? null);
      },
    canRestore(id: string): boolean {
      if (self.isBusy) return false;
      const unit = self.reviewUnit(id);
      if (unit == null || unit.approved || unit.signature?.signed == null) return false;
      if (!self.stageIsEditable(unit.stage)) return false;
      return (
        unit.pendingRemoval ||
        checkedHash(unit.signature.signed) !== checkedHash(unit.content)
      );
    },
    isApprovable,
    canApprove(id: string): boolean {
      return !self.isBusy && isApprovable(id);
    },
    /** Units with no current model verdict that a reviewer could decide now. */
    unitsAwaitingReview(step: WorkflowStage): ReviewUnit[] {
      if (!self.stageIsEditable(step)) return [];
      return self.stageUnits(step).filter((unit) => {
        if (unit.approved || unit.outdated || holds(unit.verdict, unit.checked)) return false;
        if (unit.kind === "impact") return self.outdatedItemIds(step).length === 0;
        if (unit.kind === "coverage") {
          return self.coverageChildIds(coverageParentId(unit.id)!).length > 0;
        }
        return true;
      });
    },
    /** Approving now would overrule the reviewer model: the person decides explicitly. */
    approvalNeedsDecision(id: string): boolean {
      const unit = self.reviewUnit(id);
      return unit != null && holds(unit.verdict, unit.checked) && unit.verdict!.verdict === "reject";
    },
    /** Requesting a change now would overrule the reviewer model's approval. */
    changeRequestNeedsDecision(id: string): boolean {
      const unit = self.reviewUnit(id);
      return unit != null && holds(unit.verdict, unit.checked) && unit.verdict!.verdict === "approve";
    },
    /** Outdated work in an editable stage is what a refresh regenerates. */
    canRefreshStep(step: WorkflowStage): boolean {
      if (step === WorkflowStage.Code || step === WorkflowStage.AutomatedTests) return false;
      return self.stageIsEditable(step) && self.outdatedItemIds(step).length > 0;
    },
    /** The frontier stage a generate request must refresh first. */
    stalePrerequisite(step: WorkflowStage): WorkflowStage | null {
      const prerequisite = GENERATION_PREREQUISITE_BY_WORKFLOW_STAGE[step];
      if (prerequisite == null || prerequisite !== self.frontier) return null;
      return self.outdatedItemIds(prerequisite).length > 0 ? prerequisite : null;
    },
    canRetryFailedOperation(): boolean {
      return self.pendingRetry != null;
    },
    generatorActionForStep(step: WorkflowStage): GeneratorActionName | null {
      if (
        step === WorkflowStage.InterfaceContracts &&
        self.implementationProfile != null
      ) {
        return "generateInterfaceContracts";
      }
      return GENERATOR_ACTION_BY_WORKFLOW_STAGE[step];
    },
    json(step: WorkflowStage) {
      return JSON.stringify(self.data(step));
    },
    };
  })
  .actions((self) => {
    /** Write a unit's approval to whatever carries it. */
    function writeSignature(unit: ReviewUnit, signature: Signature | null): void {
      switch (unit.kind) {
        case "field":
          self.productOverview.setPurposeSignature(signature);
          return;
        case "item":
          self.structuralFragmentsCache[unit.id]!.setSignature(signature);
          return;
        case "coverage":
        case "impact":
          writeStandalone(unit.id, { signature });
          return;
        case "artifact":
          writeArtifact(unit.id, { signature });
          return;
      }
    }
    function writeVerdict(unit: ReviewUnit, verdict: ModelVerdict | null): void {
      switch (unit.kind) {
        case "field":
          self.productOverview.setPurposeVerdict(verdict);
          return;
        case "item":
          self.structuralFragmentsCache[unit.id]!.setVerdict(verdict);
          return;
        case "coverage":
        case "impact":
          writeStandalone(unit.id, { verdict });
          return;
        case "artifact":
          writeArtifact(unit.id, { verdict });
          return;
      }
    }
    function writeStandalone(id: string, patch: Partial<StandaloneReview>): void {
      const current = self.review.units[id] ?? { signature: null, verdict: null };
      self.review = {
        ...self.review,
        units: { ...self.review.units, [id]: { ...current, ...patch } },
      };
    }
    function writeArtifact(id: string, patch: Pick<RevisionMetadata, "signature"> | Pick<RevisionMetadata, "verdict">): void {
      if (self.boundaryDesign?.id === id) {
        self.boundaryDesign = cast({ ...self.boundaryDesign, ...patch });
        return;
      }
      if (self.implementationProfile?.id === id) {
        self.implementationProfile = cast({ ...self.implementationProfile, ...patch });
        return;
      }
      if (self.projectSetup?.id === id) {
        self.projectSetup = cast({ ...self.projectSetup, ...patch });
        return;
      }
      const suite = self.contractSuite;
      if (suite == null) return;
      const update = <T extends { id: string }>(items: T[]): T[] =>
        items.map((item) => (item.id === id ? { ...item, ...patch } : item));
      self.contractSuite = cast({
        ...suite,
        interfaceContracts: update(suite.interfaceContracts),
        subjectContracts: update(suite.subjectContracts),
        verificationContracts: update(suite.verificationContracts),
      });
    }
    function acknowledgeInputs(step: WorkflowStage): void {
      if (STAGE_INPUTS[step] == null) return;
      self.review = {
        ...self.review,
        acknowledgedInputs: {
          ...self.review.acknowledgedInputs,
          [step]: self.currentInputs(step),
        },
      };
    }
    /**
     * Once nothing in a list stage still answers an upstream change — no
     * outdated item, no untouched item awaiting impact approval — the
     * stage has absorbed it, so the change stops being described.
     */
    function settleAcknowledgedInputs(step: WorkflowStage): void {
      if (!IMPACT_STAGES.has(step)) return;
      if (self.changedInputIds(step).length === 0) return;
      if (self.outdatedItemIds(step).length > 0) return;
      if (self.untouchedItemIds(step).length > 0) return;
      acknowledgeInputs(step);
    }
    function grantApproval(unit: ReviewUnit, reviewer: Reviewer, overruled: ModelVerdict | null): void {
      if (unit.kind === "item" && unit.pendingRemoval) {
        removeFragment(unit.id);
        settleAcknowledgedInputs(unit.stage);
        return;
      }
      writeSignature(
        unit,
        signatureRecord(
          unit.checked,
          unit.kind === "item" || unit.kind === "field" ? unit.content : null,
          reviewer,
          overruled,
          unit.kind === "item" && IMPACT_STAGES.has(unit.stage)
            ? self.inputsHash(unit.stage)
            : undefined,
        ),
      );
      if (unit.kind === "impact") acknowledgeInputs(unit.stage);
      settleAcknowledgedInputs(unit.stage);
    }
    function removeFragment(id: string): void {
      const fragment = self.structuralFragmentsCache[id]!;
      const stage = WORKFLOW_STAGE_BY_STRUCTURAL_FRAGMENT[fragment.type];
      const previous = self.stageListChanges.get(stage);
      self.removeEarlyFragment(fragment);
      if (previous != null) {
        self.recordStageListChange(stage, {
          ...previous,
          dropped: previous.dropped.filter((item) => item.id !== id),
        });
      }
    }
    return {
      /**
       * Re-run the rate-limited attempt. The re-dispatch is a fresh flow,
       * so gates and history treat it like pressing the original button
       * again; a missing attempt is a silent no-op.
       */
      retryFailedOperation() {
        const attempt = self.pendingRetry;
        if (attempt == null) return null;
        self.pendingRetry = null;
        const action = (self as unknown as Record<string, unknown>)[attempt.action];
        if (typeof action !== "function") {
          throw new Error(`Store has no action ${attempt.action}.`);
        }
        return (action as (...args: unknown[]) => unknown)(...attempt.args);
      },
      acknowledgeInputs,
      settleAcknowledgedInputs,
      /** Write an approval record as given; migration is the one caller that bypasses the gates. */
      recordSignature(id: string, signature: Signature) {
        const unit = self.reviewUnit(id);
        if (unit != null) writeSignature(unit, signature);
      },
      settleAllAcknowledgedInputs() {
        IMPACT_STAGES.forEach(settleAcknowledgedInputs);
      },
      /**
       * Approve a unit as a person. Overruling a current model rejection
       * needs `decided`: the person was shown both verdicts and chose.
       */
      approve(id: string, { decided = false }: { decided?: boolean } = {}) {
        const unit = self.reviewUnit(id);
        if (unit == null) throw new Error(`Cannot approve ${id}.`);
        const reason = self.stageBlockerReason(
          unit.stage,
          `before approving ${self.stageLabel(unit.stage)}`,
        );
        if (reason != null) throw new UserFacingError(reason);
        if (!self.canApprove(id)) throw new Error(`Cannot approve ${id}.`);
        const verdict = self.currentVerdictOf(id);
        if (verdict?.verdict === "reject" && !decided) {
          throw new UserFacingError(
            `The reviewer model recommends a change: ${verdict.reason} Decide whether to approve anyway.`,
          );
        }
        grantApproval(unit, PERSON, verdict?.verdict === "reject" ? verdict : null);
      },
      /** Bring a rewritten or removed item back to its signed version. */
      restoreSigned(id: string) {
        if (!self.canRestore(id)) throw new Error(`Cannot restore ${id}.`);
        const unit = self.reviewUnit(id)!;
        const signed = unit.signature!.signed as Record<string, unknown>;
        if (unit.kind === "field") {
          self.productOverview.purpose = signed.purpose as string | null;
          return;
        }
        const fragment = self.structuralFragmentsCache[id]!;
        fragment.clearPendingRemoval();
        if (fragment.type === StructuralFragmentName.TestScenario) {
          (fragment as TestScenario).restoreContent(signed as never);
        } else if (fragment.type === StructuralFragmentName.TestCase) {
          (fragment as TestCase).restoreContent(signed as never);
        } else {
          fragment.setData({
            content: signed.content as string,
            references: signed.references as ReferenceData[],
            dependencies: signed.dependencies as string[],
          });
        }
      },
      /**
       * Send untouched items back: the person withdraws their approval, and
       * they stay outdated until regenerated. The signed content stays for
       * the standing diff.
       */
      sendBackForRegeneration(ids: readonly string[]) {
        for (const id of ids) {
          const unit = self.reviewUnit(id);
          if (unit?.kind !== "item" || !self.stageIsEditable(unit.stage)) {
            throw new Error(`Cannot send back ${id}.`);
          }
          const fragment = self.structuralFragmentsCache[id]!;
          if (unit.signature != null) {
            fragment.setSignature({
              ...unit.signature,
              checked: checkedHash({ withdrawn: unit.signature.checked }),
            });
          }
          fragment.setBasis(null);
        }
      },
      setReviewMode(step: WorkflowStage, mode: ReviewMode) {
        if (mode === "auto" && reviewerModel() == null) {
          throw new UserFacingError(aiSettings().missingReviewerModelMessage);
        }
        self.review = {
          ...self.review,
          modes: { ...self.review.modes, [step]: mode },
        };
        if (mode !== "auto") return;
        // Switching to auto lets the reviewer model decide the drafts it
        // already approved; approvals already given stay as they are.
        for (const unit of self.stageUnits(step)) {
          const verdict = holds(unit.verdict, unit.checked) ? unit.verdict : null;
          if (verdict?.verdict === "approve" && self.isApprovable(unit.id)) {
            grantApproval(unit, { kind: "model", model: verdict.model }, null);
          }
        }
      },
      /**
       * Record reviewer-model verdicts. A verdict given on a state the unit
       * has since left is dropped. In auto review an approving verdict is
       * the approval.
       */
      recordVerdicts(
        verdicts: readonly { id: string; checked: string; verdict: VerdictDecision; reason: string }[],
        model: string,
      ) {
        const at = new Date().toISOString();
        for (const entry of verdicts) {
          const unit = self.reviewUnit(entry.id);
          if (unit == null || unit.checked !== entry.checked) continue;
          const verdict: ModelVerdict = {
            checked: entry.checked,
            verdict: entry.verdict,
            reason: entry.reason,
            model,
            at,
          };
          writeVerdict(unit, verdict);
          if (
            verdict.verdict === "approve" &&
            self.reviewModeOf(unit.stage) === "auto" &&
            self.isApprovable(unit.id)
          ) {
            grantApproval(self.reviewUnit(unit.id)!, { kind: "model", model }, null);
          }
        }
      },
    };
  })
  .actions((self) => {
    function listOf(entityType: StructuralFragmentName) {
      return {
        [StructuralFragmentName.PrimaryFeature]: () => self.productOverview.primaryFeatures,
        [StructuralFragmentName.TargetUser]: () => self.productOverview.targetUsers,
        [StructuralFragmentName.Requirement]: () => self.requirements,
        [StructuralFragmentName.UserStory]: () => self.userStories,
        [StructuralFragmentName.AcceptanceCriteria]: () => self.acceptanceCriteria,
        [StructuralFragmentName.TestScenario]: () => undefined,
        [StructuralFragmentName.TestCase]: () => undefined,
        [StructuralFragmentName.TestCode]: () => undefined,
      }[entityType]();
    }
    const listChangeEntry = (item: StructuralFragment) => ({
      id: item.id,
      code: item.getCode(),
      revision: proseRevision(item),
      pendingRemoval: item.pendingRemoval,
    });
    return {
      /**
       * Apply a complete regenerated list. Every listed item was written
       * against the current inputs, so each records them as its basis; a
       * stage generated from empty acknowledges its inputs.
       */
      replaceArtifactList({ entityType, items }: ArtifactListProposal) {
        const list = listOf(entityType);
        if (list == null) throw new Error(`${entityType} requires a contract-first proposal.`);
        const stage = WORKFLOW_STAGE_BY_STRUCTURAL_FRAGMENT[entityType];
        const generatedFromEmpty = list.length === 0;
        const before = list.map(listChangeEntry);
        const existingById = new Map(list.map((item) => [item.id, item]));
        const snapshots = materializeArtifactItems(items, uuid).map((item) => {
          const existing = existingById.get(item.id);
          if (existing == null) return getSnapshot(createFragment(entityType, item));
          const { id: _id, ...update } = item;
          existing.clearPendingRemoval();
          existing.setData(update);
          return getSnapshot(existing);
        });
        const keptIds = new Set(snapshots.map((item) => (item as { id: string }).id));
        list.replace(regeneratedList<StructuralFragment, unknown>(list, snapshots, keptIds, (existing) => {
          existing.markPendingRemoval();
          return getSnapshot(existing);
        }) as never[]);
        for (const item of list) {
          if (!item.pendingRemoval) item.setBasis(self.currentBasisOf(item));
        }
        self.recordStageListChange(stage, classifyListChange(before, list.map(listChangeEntry)));
        if (generatedFromEmpty) self.acknowledgeInputs(stage);
      },
      /** Apply one regenerated or removed item; a rewrite records its basis. */
      reviseFragment({ entityType, id, patch }: FragmentRevisionProposal) {
        const list = listOf(entityType);
        const fragment = [
          ...self.productOverview.primaryFeatures,
          ...self.productOverview.targetUsers,
          ...self.userStories,
          ...self.requirements,
          ...self.acceptanceCriteria,
        ].find((candidate) => candidate.id === id);
        if (fragment == null || fragment.type !== entityType) {
          throw new Error(`Cannot revise missing ${entityType} fragment ${id}.`);
        }
        const before = (list ?? [fragment]).map(listChangeEntry);
        if (patch.remove === true) {
          fragment.markPendingRemoval();
        } else {
          fragment.clearPendingRemoval();
          fragment.setData({
            content: patch.content,
            priority: patch.priority,
          });
          fragment.setBasis(self.currentBasisOf(fragment));
        }
        self.recordStageListChange(
          WORKFLOW_STAGE_BY_STRUCTURAL_FRAGMENT[entityType],
          classifyListChange(before, (list ?? []).map(listChangeEntry)),
        );
      },
    };
  })
  .views((self) => {
    /** The fragment types whose items take change requests. */
    const REQUESTABLE_FRAGMENTS: ReadonlySet<StructuralFragmentName> = new Set([
      StructuralFragmentName.PrimaryFeature,
      StructuralFragmentName.TargetUser,
      StructuralFragmentName.UserStory,
      StructuralFragmentName.Requirement,
      StructuralFragmentName.AcceptanceCriteria,
    ]);
    function formalTarget(id: string): RevisionTarget | null {
      const suite = self.contractSuite;
      if (suite == null) return null;
      if (suite.interfaceContracts.some((bundle) => bundle.id === id)) return { kind: "interface", id };
      if (suite.subjectContracts.some((bundle) => bundle.id === id)) return { kind: "subject", id };
      if (suite.verificationContracts.some((bundle) => bundle.id === id)) return { kind: "verification", id };
      return null;
    }
    /**
     * The command that asks Requireganizer's writer for a change to one
     * unit, or null for a unit that takes no change requests. The one
     * place that knows which units do.
     */
    function changeRequestCommand(unitId: string, comment: string): AiCommand | null {
      const unit = self.reviewUnit(unitId);
      if (unit == null) return null;
      switch (unit.kind) {
        case "field":
          return { kind: "comment", id: unitId, comment };
        case "item": {
          const fragment = self.structuralFragmentsCache[unitId];
          if (fragment == null || !REQUESTABLE_FRAGMENTS.has(fragment.type)) return null;
          return { kind: "comment", fragment: fragment.type, id: unitId, comment };
        }
        case "coverage": {
          const parentId = coverageParentId(unitId)!;
          const stage = unit.stage as CommandStage;
          return { kind: "revise", stage, comment: `Coverage of ${self.getCode(parentId) ?? parentId}: ${comment}` };
        }
        case "artifact": {
          if (unitId === self.boundaryDesign?.id) {
            return { kind: "revise", stage: WorkflowStage.BoundaryDesign, comment };
          }
          const target = formalTarget(unitId);
          return target == null
            ? null
            : { kind: "revise", stage: WorkflowStage.InterfaceContracts, target, comment };
        }
        case "impact":
          return null;
      }
    }
    /** Threads whose unit still exists; a thread on a removed unit is over. */
    function liveThreads(): ReviewThread[] {
      return self.threads.filter(({ unitId }) => self.reviewUnit(unitId) != null);
    }
    function openThreadOf(unitId: string): ReviewThread | null {
      return liveThreads().find((thread) => thread.unitId === unitId && thread.resolvedAt == null) ?? null;
    }
    return {
      changeRequestCommand,
      get threadAnswerer(): ThreadAnswerer {
        return self.review.answerer;
      },
      /** The unit is of a kind that takes change requests. */
      takesChangeRequests(unitId: string): boolean {
        return changeRequestCommand(unitId, "") != null;
      },
      /** The unit takes change requests now: its stage can change. */
      canRequestChange(unitId: string): boolean {
        const unit = self.reviewUnit(unitId);
        return unit != null && self.stageIsEditable(unit.stage) && changeRequestCommand(unitId, "") != null;
      },
      /** The unit's threads, oldest first. */
      threadsOf(unitId: string): ReviewThread[] {
        return liveThreads().filter((thread) => thread.unitId === unitId);
      },
      openThreadOf,
      /** A stage's open threads, oldest first. */
      openThreads(step: WorkflowStage): ReviewThread[] {
        return liveThreads().filter(
          (thread) => thread.resolvedAt == null && self.reviewUnit(thread.unitId)!.stage === step,
        );
      },
      threadsWaitingForPerson(step: WorkflowStage): number {
        return liveThreads().filter(
          (thread) => waitsForPerson(thread) && self.reviewUnit(thread.unitId)!.stage === step,
        ).length;
      },
      /** Why the answers cannot be given now, or null; a submission's answers name threads of its own stage. */
      threadAnswerProblem(
        answers: readonly ThreadAnswer[],
        author: ThreadAuthor,
        step?: WorkflowStage,
      ): string | null {
        const answerer: ThreadAnswerer | null =
          author.kind === "agent" ? "coding-agent" : author.kind === "model" ? "requireganizer" : null;
        if (answerer !== self.review.answerer) {
          return self.review.answerer === "requireganizer"
            ? "Requireganizer's AI answers change requests in this project. The person can hand them to the coding agent in Requireganizer's project menu."
            : "The coding agent answers change requests in this project.";
        }
        for (const { threadId, text } of answers) {
          const thread = liveThreads().find(({ id }) => id === threadId);
          if (thread == null) return `No open thread ${threadId}. Read the open threads with get_workflow_state.`;
          if (thread.resolvedAt != null) return `The person resolved thread ${threadId}.`;
          const stage = self.reviewUnit(thread.unitId)!.stage;
          if (step != null && stage !== step) {
            return `Thread ${threadId} is about ${self.stageLabel(stage)}; answer it with that stage's submission or with reply_to_thread.`;
          }
          if (text.trim().length === 0) return `The reply to thread ${threadId} is empty.`;
        }
        return null;
      },
    };
  })
  .actions((self) => {
    function setThreads(threads: ReviewThread[]) {
      self.threads = threads;
    }
    return {
      /**
       * The person asks for a change to a unit: a new thread, or the next
       * message of the unit's open thread. Returns the thread's id.
       */
      requestChange(unitId: string, text: string): string {
        if (!self.canRequestChange(unitId)) throw new Error(`Cannot request a change to ${unitId}.`);
        if (text.trim().length === 0) throw new UserFacingError("Write what should change.");
        const message = { author: PERSON, text: text.trim(), at: new Date().toISOString() };
        const open = self.openThreadOf(unitId);
        if (open != null) {
          setThreads(withMessage(self.threads, open.id, message));
          return open.id;
        }
        const thread: ReviewThread = { id: uuid(), unitId, messages: [message], resolvedAt: null };
        setThreads([...self.threads, thread]);
        return thread.id;
      },
      /** The person closes a thread; only the person does. */
      resolveThread(threadId: string) {
        const thread = self.threads.find(({ id }) => id === threadId);
        if (thread == null || thread.resolvedAt != null) throw new Error(`Thread ${threadId} is not open.`);
        setThreads(self.threads.map((candidate) =>
          candidate === thread ? { ...thread, resolvedAt: new Date().toISOString() } : candidate,
        ));
      },
      setThreadAnswerer(answerer: ThreadAnswerer) {
        self.review = { ...self.review, answerer };
      },
      /**
       * Post the answerer's replies. While a change waits for the person's
       * confirmation, the replies wait with it: confirming applies them
       * with the change, and cancelling drops them with it.
       */
      answerThreads(
        answers: readonly ThreadAnswer[],
        author: ThreadAuthor,
        { withSubmission = false, step }: { withSubmission?: boolean; step?: WorkflowStage } = {},
      ) {
        const problem = self.threadAnswerProblem(answers, author, step);
        if (problem != null) throw new UserFacingError(problem);
        const add = (threads: ReviewThread[]) =>
          answers.reduce(
            (current, { threadId, text }) =>
              withMessage(current, threadId, {
                author,
                text: text.trim(),
                at: new Date().toISOString(),
                ...(withSubmission ? { withSubmission: true as const } : {}),
              }),
            threads,
          );
        const pending = self.pendingImpactChange;
        if (pending != null) {
          const candidate = pending.candidateSnapshot as { threads?: ReviewThread[] };
          self.pendingImpactChange = {
            ...pending,
            candidateSnapshot: { ...candidate, threads: add(candidate.threads ?? []) },
          };
          return;
        }
        setThreads(add(self.threads));
      },
    };
  });

// Every AI flow, under the property name it is assigned on the store. The
// timeline declares each of these as a step: the property name admits the
// flow's root action (property keys survive minification), and the flow's
// `__timelineStep` tag supplies the operation label.
const aiFlows = {
  answerThread,
  sendConversationMessage,
  regenerateLastReply,
  refreshStage,
  generateProductOverview,
  generateUserStories,
  generateRequirements,
  generateAcceptanceCriteria,
  generateBoundaryDesign,
  generateImplementationProfile,
  generateInterfaceContracts,
  generateTestScenarios,
  generateTestCases,
  generateProjectSetup,
  generateTestCode,
  reviewStage,
  submitAgentProposal,
};

export const Store = FlatStore.actions(
  withSelf(aiFlows),
).actions(withSelf({ import: import_ }));

for (const [actionName, flow_] of Object.entries(aiFlows)) {
  bindFlowAction(flow_, actionName);
  const step = (
    flow_ as { __timelineStep?: { kind: "ai"; label: string } }
  ).__timelineStep;
  if (step != null) {
    declareTimelineStep(actionName, step);
  }
}

export type FlatStore = Instance<typeof FlatStore>;
export type Store = Instance<typeof Store>;

/** The replicated volatile values of a store, as the authority sends them. */
export function replicatedVolatileState(store: FlatStore): ReplicatedVolatileState {
  const values: Partial<Record<keyof ReplicatedVolatileState, unknown>> = {};
  for (const key of REPLICATED_VOLATILE_KEYS) values[key] = store[key];
  return values as ReplicatedVolatileState;
}

/**
 * The one way a stored module snapshot becomes a live store: creation
 * goes through the import gate, so every consumer gets full validation.
 */
export function createModuleStore(snapshot: unknown): Store {
  const store = Store.create({ productOverview: {} });
  store.import(snapshot);
  return store;
}

/** Whether a project setup with scaffold files is present — live store or stored snapshot. */
export function hasGeneratedScaffoldIn(
  projectSetup: unknown,
  scaffoldFileCount: number,
): boolean {
  return projectSetup != null && scaffoldFileCount > 0;
}

/**
 * Run a stage's generator with an optional user hint. A plain function,
 * deliberately not a store action: the timeline admits only root calls of
 * declared steps, so the generator must be invoked directly for its turn
 * to open. An action wrapper would nest the call, and the generation
 * would run with no history entry and no presentation. The two flows with
 * leading parameters take the hint second; every other flow takes it
 * first, so this is the one place that knows the shapes.
 */
export function generateStep(store: Store, step: WorkflowStage, hint?: string): void {
  if (step === WorkflowStage.TestCases) {
    void store.generateTestCases(null, hint);
    return;
  }
  if (step === WorkflowStage.ProductOverview) {
    void store.generateProductOverview(null, hint);
    return;
  }
  const action = GENERATOR_ACTION_BY_WORKFLOW_STAGE[step];
  if (action == null) return;
  void (store[action] as (hint?: string) => unknown)(hint);
}

/**
 * Refresh a stale stage with an optional user hint. A plain function for
 * the same timeline reason as generateStep: the refresh flow must run as
 * a root call so its turn opens.
 */
export function refreshStep(store: Store, step: WorkflowStage, hint?: string): void {
  void store.refreshStage(step, hint);
}
export const storeContext = createContext<Store>(null!);
export const useStore = () => useContext(storeContext);
