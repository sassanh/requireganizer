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
  type ApprovalStatus,
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
  handleOverviewFieldComment,
  import as import_,
  requestStageChange,
  reviseFormalContract,
  sendConversationMessage,
  regenerateLastReply,
} from "./actions";
import { asApprovedRevision, asDraftRevision, isApproved } from "./approval";
import {
  GENERATION_PREREQUISITE_BY_WORKFLOW_STAGE,
  GENERATOR_ACTION_BY_WORKFLOW_STAGE,
  LAST_WORKFLOW_STAGE,
  Priority,
  WORKFLOW_STAGE_BY_STRUCTURAL_FRAGMENT,
  WORKFLOW_STAGES,
  WORKFLOW_STAGE_LABELS,
  OVERVIEW_NAME_QUALITY_ID,
  OVERVIEW_PURPOSE_QUALITY_ID,
  Status,
  WorkflowStage,
  type GeneratorActionName,
  StructuralFragment as StructuralFragmentName,
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
import { declareTimelineStep } from "./timeline/controller";
import { withSelf } from "./utilities";

export { PROJECT_SCHEMA_VERSION } from "lib/projectSchema";
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
  approval?: ApprovalStatus;
  lastSignedContent?: string | null;
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
  approval?: ApprovalStatus;
  lastSignedContent?: string | null;
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
      name: source.productOverview.name,
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

interface WorkflowInputSource {
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

const NON_INPUT_FINGERPRINT_KEYS = new Set([
  "quality",
  "qualityIssues",
  "nameQuality",
  "purposeQuality",
  "nameIssues",
  "purposeIssues",
  "approval",
  "nameApproval",
  "purposeApproval",
  "lastSignedContent",
  "lastSignedName",
  "lastSignedPurpose",
  "pendingRemoval",
  "status",
  "approvedAt",
]);

function omitNonInputFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitNonInputFields);
  if (value == null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !NON_INPUT_FINGERPRINT_KEYS.has(key))
      .map(([key, item]) => [key, omitNonInputFields(item)]),
  );
}

export function buildWorkflowInput(
  source: WorkflowInputSource,
  step: WorkflowStage,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (step === WorkflowStage.ProductOverview) return result;
  result.productOverview = omitNonInputFields(source.productOverview);
  if (step === WorkflowStage.UserStories) return result;
  result.userStories = omitNonInputFields(source.userStories);
  if (step === WorkflowStage.Requirements) return result;
  result.requirements = omitNonInputFields(source.requirements);
  if (step === WorkflowStage.AcceptanceCriteria) return result;
  result.acceptanceCriteria = omitNonInputFields(source.acceptanceCriteria);
  if (step === WorkflowStage.BoundaryDesign) return result;
  result.boundaryDesign = omitNonInputFields(source.boundaryDesign);
  if (step === WorkflowStage.InterfaceContracts) return result;
  result.implementationProfile = omitNonInputFields(source.implementationProfile);
  result.contractSuite = omitNonInputFields(source.contractSuite);
  if (step === WorkflowStage.TestScenarios) return result;
  result.testScenarios = scenarioDesign(source.testScenarios).map(
    ({ testCases: _testCases, ...scenario }) => scenario,
  );
  if (step === WorkflowStage.TestCases) return result;
  result.testScenarios = scenarioDesign(source.testScenarios);
  if (step === WorkflowStage.ProjectSetup) return result;
  result.projectSetup = omitNonInputFields(source.projectSetup);
  return result;
}

export function workflowFingerprint(source: WorkflowInputSource, step: WorkflowStage) {
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

export const ScaffoldFileModel = types.model({
  path: types.refinement("SafeVirtualFilePath", types.string, isSafeVirtualPath),
  content: types.string,
});

export const FlatStore = types
  .model("Store", {
    schemaVersion: types.optional(types.literal(PROJECT_SCHEMA_VERSION), PROJECT_SCHEMA_VERSION),
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
    stageInputFingerprints: types.map(types.string),
    stageListChanges: types.map(types.frozen<ListChange>()),
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
      self.stageListChanges.clear();
      self.systemMessage = null;
      self.pendingImpactChange = null;
      self.contractRevisionDiff = null;
      self.thinkingLabel = null;
      self.thinkingText = "";
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
    markStageGenerated(step: WorkflowStage) {
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
      const toSnapshot = (item: ProductOverviewPatchItem): SnapshotIn<PrimaryFeature | TargetUser> => {
        const content = typeof item === "string" ? item : item.content;
        // Bare string here is new content only during initial creation (no existing ids to keep);
        // patch paths with existing ids are handled in applyProductOverviewProposal, not here.
        return { content } as SnapshotIn<PrimaryFeature | TargetUser>;
      };
      self.productOverview = ProductOverviewModel.create({
        name: info.name,
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
    setName({ name }: { name: string }) {
      if (self.productOverview.name === name) return;
      self.productOverview.uncheckName();
      self.productOverview.name = name;
      self.productOverview.reapproveNameIfMatchesSigned();
    },
    setPurpose({ purpose }: { purpose: string }) {
      if (self.productOverview.purpose === purpose) return;
      self.productOverview.uncheckPurpose();
      self.productOverview.purpose = purpose;
      self.productOverview.reapprovePurposeIfMatchesSigned();
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
    updateBoundaryText(
      collection: "subjects" | "interfaces" | "interactions" | "verificationObligations",
      id: string,
      field: string,
      value: string,
    ) {
      if (self.boundaryDesign == null) return;
      self.boundaryDesign = cast(asDraftRevision({
        ...self.boundaryDesign,
        [collection]: self.boundaryDesign[collection].map((item) =>
          item.id === id ? { ...item, [field]: value } : item,
        ),
      }));
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
      self.implementationProfile = cast(asDraftRevision({
        ...self.implementationProfile,
        [field]: value,
      }));
    },
    updateImplementationProfileConstraints(value: string) {
      if (self.implementationProfile == null) {
        return;
      }
      self.implementationProfile = cast(asDraftRevision({
        ...self.implementationProfile,
        constraints: value
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean),
      }));
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
          approval: scenario.approval ?? "draft",
          lastSignedContent: scenario.lastSignedContent ?? null,
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
          approval: testCase.approval ?? "draft",
          lastSignedContent: testCase.lastSignedContent ?? null,
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
      self.markStageGenerated(WorkflowStage.ProjectSetup);
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
      const before: ListChangeBeforeItem[] = list.map((item) => ({
        id: item.id,
        code: item.getCode(),
      }));
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
      for (const existing of list) {
        if (keptIds.has(existing.id)) continue;
        existing.markPendingRemoval();
        snapshots.push(getSnapshot(existing));
      }
      list.replace(snapshots as never[]);
      const after: ListChangeAfterItem[] = list.map((item) => ({
        id: item.id,
        lastSignedContent: item.lastSignedContent,
        pendingRemoval: item.pendingRemoval,
      }));
      self.recordStageListChange(
        WORKFLOW_STAGE_BY_STRUCTURAL_FRAGMENT[entityType],
        classifyListChange(before, after),
      );
    },
    reviseFragment({ entityType, id, patch }: FragmentRevisionProposal) {
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
      const before: ListChangeBeforeItem[] =
        list == null
          ? [{ id: fragment.id, code: fragment.getCode() }]
          : list.map((item) => ({ id: item.id, code: item.getCode() }));
      if (patch.remove === true) {
        fragment.markPendingRemoval();
      } else {
        fragment.clearPendingRemoval();
        fragment.setData({
          content: patch.content,
          priority: patch.priority,
        });
      }
      const after: ListChangeAfterItem[] =
        list == null
          ? []
          : list.map((item) => ({
              id: item.id,
              lastSignedContent: item.lastSignedContent,
              pendingRemoval: item.pendingRemoval,
            }));
      self.recordStageListChange(
        WORKFLOW_STAGE_BY_STRUCTURAL_FRAGMENT[entityType],
        classifyListChange(before, after),
      );
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
    data(step: WorkflowStage = LAST_WORKFLOW_STAGE, includeBuildArtifacts = false) {
      return {
        schemaVersion: PROJECT_SCHEMA_VERSION,
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
  .views((self) => {
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
          return self.testScenarios.some(
            ({ testCases }) => testCases.length > 0,
          );
        case WorkflowStage.ProjectSetup:
          return self.projectSetup != null;
        case WorkflowStage.AutomatedTests:
          return self.testScenarios.some((scenario) =>
            scenario.testCases.some(
              ({ generatedInputFingerprint }) =>
                generatedInputFingerprint != null,
            ),
          );
        case WorkflowStage.Code:
          return false;
      }
    }
    function getStepStatus(step: WorkflowStage): Status {
      if (stageIsLocked(step)) return Status.Locked;
      const generated = self.stageInputFingerprints.get(step);
      const inputIsOutdated =
        generated != null && generated !== workflowFingerprint(self, step);
      const stageIssues = self.mechanicalIssues.filter((issue) => issue.stage === step);
      let status: Status;
      let hasArtifacts: boolean;
      switch (step) {
        case WorkflowStage.ProductOverview:
          hasArtifacts = !self.productOverview.isEmpty;
          status =
            self.productOverview.isComplete && stageIssues.length === 0
              ? Status.Completed
              : Status.Pending;
          break;
        case WorkflowStage.UserStories:
          hasArtifacts = self.userStories.length > 0;
          status =
            hasArtifacts && stageIssues.length === 0
              ? Status.Completed
              : Status.Pending;
          break;
        case WorkflowStage.Requirements:
          hasArtifacts = self.requirements.length > 0;
          status =
            hasArtifacts && stageIssues.length === 0
              ? Status.Completed
              : Status.Pending;
          break;
        case WorkflowStage.AcceptanceCriteria:
          hasArtifacts = self.acceptanceCriteria.length > 0;
          status =
            hasArtifacts && stageIssues.length === 0
              ? Status.Completed
              : Status.Pending;
          break;
        case WorkflowStage.BoundaryDesign:
          hasArtifacts = self.boundaryDesign != null;
          status =
            hasArtifacts && stageIssues.length === 0
              ? Status.Completed
              : Status.Pending;
          break;
        case WorkflowStage.InterfaceContracts:
          hasArtifacts =
            self.implementationProfile != null || self.contractSuite != null;
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
        case WorkflowStage.TestScenarios:
          hasArtifacts = self.testScenarios.length > 0;
          status =
            hasArtifacts &&
            self.testScenarios.every(({ binding }) => binding != null) &&
            stageIssues.length === 0
              ? Status.Completed
              : Status.Pending;
          break;
        case WorkflowStage.TestCases:
          hasArtifacts = self.testScenarios.some(
            ({ testCases }) => testCases.length > 0,
          );
          status =
            self.testScenarios.length > 0 &&
            self.testScenarios.every(
              (scenario) =>
                scenario.testCases.length > 0 &&
                scenario.testCases.every(({ definition }) => definition != null),
            ) &&
            stageIssues.length === 0
              ? Status.Completed
              : Status.Pending;
          break;
        case WorkflowStage.ProjectSetup:
          hasArtifacts = self.projectSetup != null;
          status = self.projectSetup == null ? Status.Pending : Status.Completed;
          if (status === Status.Completed && !self.projectSetupIsCurrent) {
            status = Status.Outdated;
          }
          break;
        case WorkflowStage.AutomatedTests: {
          const hasGeneratedTests = self.testScenarios.some((scenario) =>
            scenario.testCases.some(
              ({ generatedInputFingerprint }) =>
                generatedInputFingerprint != null,
            ),
          );
          hasArtifacts = hasGeneratedTests;
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
        case WorkflowStage.Code:
          hasArtifacts = false;
          status = Status.Pending;
          break;
      }
      if (hasArtifacts && inputIsOutdated) return Status.Outdated;
      if (
        status === Status.Completed &&
        step !== WorkflowStage.AutomatedTests &&
        step !== WorkflowStage.Code &&
        !(self as unknown as { stageIsApproved: (stage: WorkflowStage) => boolean }).stageIsApproved(step)
      ) {
        return Status.Outdated;
      }
      return status;
    }
    function firstPendingPredecessor(step: WorkflowStage): WorkflowStage | null {
      for (const previous of WORKFLOW_STAGES) {
        if (previous === step) return null;
        if (getStepStatus(previous) === Status.Pending) return previous;
      }
      return null;
    }
    function stageIsLocked(step: WorkflowStage): boolean {
      if (hasStepArtifacts(step)) return false;
      for (const previous of WORKFLOW_STAGES) {
        if (previous === step) return false;
        if (getStepStatus(previous) !== Status.Completed) return true;
      }
      return false;
    }
    function resolveOpenStep(step: WorkflowStage): WorkflowStage {
      if (!stageIsLocked(step)) return step;
      const index = WORKFLOW_STAGES.indexOf(step);
      for (let i = index - 1; i >= 0; i--) {
        if (!stageIsLocked(WORKFLOW_STAGES[i])) return WORKFLOW_STAGES[i];
      }
      return WorkflowStage.ProductOverview;
    }
    return {
      getCode(id: string) {
        return self.structuralFragmentsCache[id]?.getCode();
      },
      getPath(id: string) {
        const fragment = self.structuralFragmentsCache[id];
        if (fragment == null) return undefined;
        return `?step=${WORKFLOW_STAGE_BY_STRUCTURAL_FRAGMENT[fragment.type]}#${fragment.getCode()}`;
      },
      get isProjectSetupOutdated() {
        return self.projectSetup != null && !self.projectSetupIsCurrent;
      },
      mechanicalIssuesForStage(step: WorkflowStage): MechanicalIssue[] {
        return self.mechanicalIssues.filter((issue) => issue.stage === step);
      },
      mechanicalIssuesForItem(id: string): MechanicalIssue[] {
        return self.mechanicalIssues.filter((issue) => issue.itemId === id);
      },
      stageListChange(step: WorkflowStage): ListChange | undefined {
        return self.stageListChanges.get(step);
      },
      stageListChangeCaption(step: WorkflowStage) {
        const change = self.stageListChanges.get(step);
        if (change == null) return null;
        return listChangeCaption(change);
      },
      hasStepArtifacts,
      firstPendingPredecessor,
      stageIsLocked,
      resolveOpenStep,
      getStepStatus,
    };
  })
  .views((self) => {
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
    const allApproved = (values: readonly ApprovalStatus[]): boolean =>
      values.length > 0 && values.every(isApproved);
    const approvalOf = (id: string): ApprovalStatus | null => {
      if (id === OVERVIEW_NAME_QUALITY_ID) return self.productOverview.nameApproval;
      if (id === OVERVIEW_PURPOSE_QUALITY_ID) return self.productOverview.purposeApproval;
      const fragment = self.structuralFragmentsCache[id];
      if (fragment != null) return fragment.approval;
      if (self.boundaryDesign?.id === id) return self.boundaryDesign.status;
      if (self.implementationProfile?.id === id) return self.implementationProfile.status;
      if (self.projectSetup?.id === id) return self.projectSetup.status;
      return contractBundle(id)?.status ?? null;
    };
    const stageIsApproved = (step: WorkflowStage): boolean => {
      switch (step) {
        case WorkflowStage.ProductOverview:
          return (
            isApproved(self.productOverview.nameApproval) &&
            isApproved(self.productOverview.purposeApproval) &&
            allApproved(self.productOverview.primaryFeatures.map((item) => item.approval)) &&
            allApproved(self.productOverview.targetUsers.map((item) => item.approval))
          );
        case WorkflowStage.UserStories:
          return allApproved(self.userStories.map((item) => item.approval));
        case WorkflowStage.Requirements:
          return allApproved(self.requirements.map((item) => item.approval));
        case WorkflowStage.AcceptanceCriteria:
          return allApproved(self.acceptanceCriteria.map((item) => item.approval));
        case WorkflowStage.BoundaryDesign:
          return isApproved(self.boundaryDesign?.status);
        case WorkflowStage.InterfaceContracts:
          return (
            self.contractsReady &&
            isApproved(self.implementationProfile?.status) &&
            allApproved([
              ...(self.contractSuite?.interfaceContracts.map((item) => item.status) ?? []),
              ...(self.contractSuite?.subjectContracts.map((item) => item.status) ?? []),
              ...(self.contractSuite?.verificationContracts.map((item) => item.status) ?? []),
            ])
          );
        case WorkflowStage.TestScenarios:
          return allApproved(self.testScenarios.map((item) => item.approval));
        case WorkflowStage.TestCases:
          return allApproved(
            self.testScenarios.flatMap((scenario) =>
              scenario.testCases.map((item) => item.approval),
            ),
          );
        case WorkflowStage.ProjectSetup:
          return isApproved(self.projectSetup?.status);
        case WorkflowStage.AutomatedTests:
        case WorkflowStage.Code:
          return false;
      }
    };
    const cannotGenerateReason = (step: WorkflowStage): string | null => {
      if (GENERATOR_ACTION_BY_WORKFLOW_STAGE[step] == null) {
        return "This stage has no generate action.";
      }
      const prerequisite = GENERATION_PREREQUISITE_BY_WORKFLOW_STAGE[step];
      if (prerequisite == null) return null;
      const label = WORKFLOW_STAGE_LABELS[prerequisite];
      const target = WORKFLOW_STAGE_LABELS[step];
      const status = self.getStepStatus(prerequisite);
      if (status === Status.Pending || status === Status.Locked) {
        const blocker = self.firstPendingPredecessor(step) ?? prerequisite;
        return `Complete ${WORKFLOW_STAGE_LABELS[blocker]} to generate ${target}.`;
      }
      if (!stageIsApproved(prerequisite)) {
        return `Approve ${label} to generate ${target}.`;
      }
      if (status === Status.Outdated) {
        return `Regenerate ${label} to generate ${target}.`;
      }
      if (
        step === WorkflowStage.InterfaceContracts &&
        self.implementationProfile != null &&
        !isApproved(self.implementationProfile.status)
      ) {
        return "Approve the implementation profile to generate Interface Contracts.";
      }
      return null;
    };

    return {
      approvalOf,
      stageIsApproved,
      cannotGenerateReason,
      canApprove(id: string): boolean {
        if (self.isBusy) return false;
        const status = approvalOf(id);
        if (status == null || status === "approved") return false;
        if (id === OVERVIEW_NAME_QUALITY_ID) {
          return (self.productOverview.name?.trim().length ?? 0) > 0;
        }
        if (id === OVERVIEW_PURPOSE_QUALITY_ID) {
          return (self.productOverview.purpose?.trim().length ?? 0) > 0;
        }
        const fragment = self.structuralFragmentsCache[id];
        if (fragment != null) {
          if (fragment.pendingRemoval) return true;
          return fragment.content.trim().length > 0;
        }
        return true;
      },
      canGenerateStep(step: WorkflowStage): boolean {
        return cannotGenerateReason(step) == null;
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
    };
  })
  .views((self) => ({
    json(step: WorkflowStage) {
      return JSON.stringify(self.data(step));
    },
    affectedDownstreamSteps(
      sourceStep: WorkflowStage,
      includeSourceStep = false,
    ): WorkflowStage[] {
      return WORKFLOW_STAGES.slice(
        WORKFLOW_STAGES.indexOf(sourceStep) + (includeSourceStep ? 0 : 1),
      ).filter(
        (step) =>
          step !== WorkflowStage.Code &&
          (
            self.getStepStatus(step) !== Status.Pending ||
            self.hasStepArtifacts(step)
          ),
      );
    },
  }))
  .actions((self) => ({
    approve(id: string) {
      if (!self.canApprove(id)) {
        throw new Error(`Cannot approve ${id}.`);
      }
      if (id === OVERVIEW_NAME_QUALITY_ID) {
        self.productOverview.approveName();
        return;
      }
      if (id === OVERVIEW_PURPOSE_QUALITY_ID) {
        self.productOverview.approvePurpose();
        return;
      }
      const fragment = self.structuralFragmentsCache[id];
      if (fragment != null) {
        if (fragment.pendingRemoval) {
          const stage = WORKFLOW_STAGE_BY_STRUCTURAL_FRAGMENT[fragment.type];
          const previous = self.stageListChanges.get(stage);
          self.removeEarlyFragment(fragment);
          if (previous != null) {
            self.recordStageListChange(stage, {
              ...previous,
              dropped: previous.dropped.filter((item) => item.id !== id),
            });
          }
          return;
        }
        fragment.approve();
        return;
      }
      if (self.boundaryDesign?.id === id) {
        self.boundaryDesign = cast(asApprovedRevision(self.boundaryDesign));
        return;
      }
      if (self.implementationProfile?.id === id) {
        self.implementationProfile = cast(asApprovedRevision(self.implementationProfile));
        return;
      }
      if (self.projectSetup?.id === id) {
        self.projectSetup = cast(asApprovedRevision(self.projectSetup));
        return;
      }
      if (self.contractSuite != null) {
        self.contractSuite = cast({
          ...self.contractSuite,
          interfaceContracts: self.contractSuite.interfaceContracts.map((item) =>
            item.id === id ? asApprovedRevision(item) : item,
          ),
          subjectContracts: self.contractSuite.subjectContracts.map((item) =>
            item.id === id ? asApprovedRevision(item) : item,
          ),
          verificationContracts: self.contractSuite.verificationContracts.map((item) =>
            item.id === id ? asApprovedRevision(item) : item,
          ),
        });
      }
    },
  }));

// Every AI flow, under the property name it is assigned on the store. The
// timeline declares each of these as a step: the property name admits the
// flow's root action (property keys survive minification), and the flow's
// `__timelineStep` tag supplies the operation label.
const aiFlows = {
  handleComment,
  sendConversationMessage,
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
  handleOverviewFieldComment,
  requestStageChange,
};

export const Store = FlatStore.actions(
  withSelf(aiFlows),
).actions(withSelf({ import: import_, export: export_, exportCode }))
  /**
   * Run a stage's generator with an optional user hint. The two flows with
   * leading parameters take the hint second; every other flow takes it
   * first, so this is the one place that knows the shapes.
   */
  .actions((self) => ({
    generateStep(step: WorkflowStage, hint?: string): void {
      if (step === WorkflowStage.TestCases) {
        void self.generateTestCases(undefined, hint);
        return;
      }
      if (step === WorkflowStage.ProductOverview) {
        void self.generateProductOverview(undefined, hint);
        return;
      }
      const action = GENERATOR_ACTION_BY_WORKFLOW_STAGE[step];
      if (action == null) return;
      void (self[action] as (hint?: string) => unknown)(hint);
    },
  }));

for (const [actionName, flow_] of Object.entries(aiFlows)) {
  const step = (
    flow_ as { __timelineStep?: { kind: "ai"; label: string } }
  ).__timelineStep;
  if (step != null) {
    declareTimelineStep(actionName, step);
  }
}

export type FlatStore = Instance<typeof FlatStore>;
export type Store = Instance<typeof Store>;
export const storeContext = createContext<Store>(null!);
export const useStore = () => useContext(storeContext);
