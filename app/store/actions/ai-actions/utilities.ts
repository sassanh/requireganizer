import {
  SnapshotOrInstance,
  applySnapshot,
  clone,
  flow,
  getSnapshot,
} from "mobx-state-tree";

import {
  ArtifactListProposal,
  FragmentRevisionProposal,
  ProductOverviewPatchItem,
  ProductOverviewProposal,
  TestCodeProposal,
} from "ai-harness/contracts";
import { getArtifactStageDefinition } from "ai-harness/workflow";
import type {
  ApprovalStatus,
  BoundaryDesign,
  BoundaryDesignProposal,
  ContractSuite,
  ContractSuiteProposal,
  ImplementationProfile,
  ImplementationProfileProposal,
  ProjectSetup,
  ProjectSetupProposal,
  RevisionMetadata,
  TestCaseListProposal,
  TestScenarioListProposal,
} from "contract-domain";
import {
  fingerprint,
  formatContractSuiteDiff,
  sha256Text,
  validateBoundaryDesign,
  validateContractSuite,
  validateProjectSetup,
} from "contract-domain";
import { getUserFacingErrorMessage, isRateLimitError, isTimeoutError, UserFacingError } from "lib/errors";
import { HarnessResult } from "lib/types";
import {
  OVERVIEW_NAME_QUALITY_ID,
  OVERVIEW_PURPOSE_QUALITY_ID,
  Priority,
  Status,
  WorkflowStage,
  StructuralFragment,
  isBefore,
} from "store/constants";
import { classifyListChange, regeneratedList } from "store/listChange";
import {
  dependenciesEqual,
  referencesEqual,
  type StructuralFragment as Fragment,
} from "store/models/StructuralFragment";
import { itemSetRevision } from "store/review";
import type { FlatStore, TestCaseSnapshotInput, TestScenarioSnapshotInput } from "store/store";
import { uuid } from "utilities";

/**
 * The one way a proposal reaches project state. The update runs on a
 * clone; when the result moves the frontier back while later stages hold
 * work, the change waits for the person to confirm instead of applying.
 */
export function applyAtomically(
  store: FlatStore,
  update: (candidate: FlatStore) => void,
  summary = "Apply the change.",
): void {
  const candidate = clone(store);
  update(candidate);
  candidate.settleAllAcknowledgedInputs();
  const snapshot = getSnapshot(candidate);
  const from = store.frontier;
  const to = candidate.frontier;
  const movesBack = to != null && (from == null || isBefore(to, from));
  const laterWork = movesBack ? candidate.laterStagesHoldingWork(to) : [];
  if (to != null && laterWork.length > 0) {
    const label = store.stageLabel(to);
    store.queueImpactChange({
      sourceStep: to,
      sourceLabel: label,
      affectedSteps: laterWork,
      affectedArtifacts: laterWork.map((step) => ({
        step,
        label: store.stageLabel(step),
        reason: `Stays visible and read-only until ${label} is complete again.`,
      })),
      summary,
      candidateSnapshot: snapshot,
    });
    return;
  }
  applySnapshot(store, snapshot);
}

/** Approval of a formal artifact this operation builds on; the frontier normally guarantees it. */
function requireApproved<T extends { id: string }>(
  store: FlatStore,
  artifact: T | null | undefined,
  label: string,
): asserts artifact is T {
  if (artifact == null || store.approvalOf(artifact.id) !== "approved") {
    throw new UserFacingError(`An approved ${label} is required.`);
  }
}

export function applyProductOverviewProposal(
  store: FlatStore,
  proposal: ProductOverviewProposal,
): void {
  applyAtomically(store, (candidate) => {
    const overview = candidate.productOverview;
    const entry = (id: string, code: string) => ({
      id,
      code,
      revision: candidate.revisionOf(id)!,
    });
    const before = [
      entry(OVERVIEW_NAME_QUALITY_ID, "Name"),
      entry(OVERVIEW_PURPOSE_QUALITY_ID, "Purpose"),
      ...overview.primaryFeatures.map((item) => entry(item.id, item.getCode())),
      ...overview.targetUsers.map((item) => entry(item.id, item.getCode())),
    ];
    const existingFeatures = new Map(
      overview.primaryFeatures.map((item) => [item.id, item] as const),
    );
    const existingUsers = new Map(
      overview.targetUsers.map((item) => [item.id, item] as const),
    );
    const toFeatureSnapshot = (item: ProductOverviewPatchItem): unknown => {
      if (typeof item === "string") {
        const existing = existingFeatures.get(item);
        if (existing == null) throw new Error(`Unknown primaryFeature id ${item}`);
        existing.clearPendingRemoval();
        return getSnapshot(existing);
      }
      if (item.id != null) {
        const existing = existingFeatures.get(item.id);
        if (existing == null) throw new Error(`Unknown primaryFeature id ${item.id}`);
        existing.clearPendingRemoval();
        existing.setData({ content: item.content });
        return getSnapshot(existing);
      }
      return { content: item.content };
    };
    const toUserSnapshot = (item: ProductOverviewPatchItem): unknown => {
      if (typeof item === "string") {
        const existing = existingUsers.get(item);
        if (existing == null) throw new Error(`Unknown targetUser id ${item}`);
        existing.clearPendingRemoval();
        return getSnapshot(existing);
      }
      if (item.id != null) {
        const existing = existingUsers.get(item.id);
        if (existing == null) throw new Error(`Unknown targetUser id ${item.id}`);
        existing.clearPendingRemoval();
        existing.setData({ content: item.content });
        return getSnapshot(existing);
      }
      return { content: item.content };
    };
    const proposedFeatureIds = new Set(
      proposal.primaryFeatures.flatMap((item) =>
        typeof item === "string" ? [item] : item.id != null ? [item.id] : [],
      ),
    );
    const proposedUserIds = new Set(
      proposal.targetUsers.flatMap((item) =>
        typeof item === "string" ? [item] : item.id != null ? [item.id] : [],
      ),
    );
    const drop = (existing: Fragment): unknown => {
      existing.markPendingRemoval();
      return getSnapshot(existing);
    };
    const featureSnapshots = regeneratedList(
      overview.primaryFeatures,
      proposal.primaryFeatures.map(toFeatureSnapshot),
      proposedFeatureIds,
      drop,
    );
    const userSnapshots = regeneratedList(
      overview.targetUsers,
      proposal.targetUsers.map(toUserSnapshot),
      proposedUserIds,
      drop,
    );
    candidate.setName({ name: proposal.name });
    candidate.setPurpose({ purpose: proposal.purpose });
    candidate.setPrimaryFeatures({
      primaryFeatures: featureSnapshots as never,
    });
    candidate.setTargetUsers({
      targetUsers: userSnapshots as never,
    });
    candidate.recordStageListChange(
      WorkflowStage.ProductOverview,
      classifyListChange(before, [
        entry(OVERVIEW_NAME_QUALITY_ID, "Name"),
        entry(OVERVIEW_PURPOSE_QUALITY_ID, "Purpose"),
        ...[...overview.primaryFeatures, ...overview.targetUsers].map((item) => ({
          ...entry(item.id, item.getCode()),
          pendingRemoval: item.pendingRemoval,
        })),
      ]),
    );
  });
}

export function applyArtifactListProposal(
  store: FlatStore,
  proposal: ArtifactListProposal,
): void {
  applyAtomically(store, (candidate) => candidate.replaceArtifactList(proposal));
}

export function applyFragmentRevisionProposal(
  store: FlatStore,
  proposal: FragmentRevisionProposal,
): void {
  applyAtomically(store, (candidate) => {
    candidate.reviseFragment(proposal);
  });
}

export function applyTestCodeProposal(
  store: FlatStore,
  proposal: TestCodeProposal,
  testCaseId: string,
  inputFingerprint: string,
): void {
  applyAtomically(store, (candidate) => {
    candidate.setScaffoldFile(proposal.path, proposal.code);
    candidate.markTestGenerated(testCaseId, inputFingerprint);
  });
}

function revisionMetadata(previous?: { id: string; revision: number }): RevisionMetadata {
  return {
    id: previous?.id ?? uuid(),
    revisionId: uuid(),
    revision: (previous?.revision ?? 0) + 1,
    createdAt: new Date().toISOString(),
  };
}

export function materializeBoundaryDesign(
  proposal: BoundaryDesignProposal,
  sourceRevisions: {
    requirementsRevisionId: string;
    acceptanceCriteriaRevisionId: string;
  },
  previous?: BoundaryDesign | null,
): BoundaryDesign {
  return {
    ...revisionMetadata(previous ?? undefined),
    ...sourceRevisions,
    ...proposal,
  };
}

export function applyBoundaryDesignProposal(
  store: FlatStore,
  proposal: BoundaryDesignProposal,
): void {
  const sourceRevisions = {
    requirementsRevisionId: itemSetRevision(store.requirements),
    acceptanceCriteriaRevisionId: itemSetRevision(store.acceptanceCriteria),
  };
  const design = materializeBoundaryDesign(
    proposal,
    sourceRevisions,
    store.boundaryDesign,
  );
  validateBoundaryDesign(design, {
    requirementIds: new Set(store.requirements.map(({ id }) => id)),
    acceptanceCriteriaIds: new Set(store.acceptanceCriteria.map(({ id }) => id)),
    ...sourceRevisions,
  });
  applyAtomically(
    store,
    (candidate) => {
      candidate.setBoundaryDesign(design);
      candidate.acknowledgeInputs(WorkflowStage.BoundaryDesign);
    },
    "Apply the new boundary-design revision.",
  );
}

export function materializeImplementationProfile(
  proposal: ImplementationProfileProposal,
  boundaryRevisionId: string,
  previous?: ImplementationProfile | null,
): ImplementationProfile {
  return {
    ...revisionMetadata(previous ?? undefined),
    boundaryRevisionId,
    ...proposal,
  };
}

export function applyImplementationProfileProposal(
  store: FlatStore,
  proposal: ImplementationProfileProposal,
): void {
  requireApproved(store, store.boundaryDesign, "boundary design");
  const profile = materializeImplementationProfile(
    proposal,
    store.boundaryDesign.revisionId,
    store.implementationProfile,
  );
  applyAtomically(
    store,
    (candidate) => {
      candidate.setImplementationProfile(profile);
      candidate.acknowledgeInputs(WorkflowStage.InterfaceContracts);
    },
    "Apply the new implementation-profile revision.",
  );
}

export function materializeContractSuite(
  proposal: ContractSuiteProposal,
  design: BoundaryDesign,
  profile: ImplementationProfile,
  previous?: ContractSuite | null,
): ContractSuite {
  const now = new Date().toISOString();
  const interfaceContracts = proposal.interfaceContracts.map((candidate) => {
    const prior = previous?.interfaceContracts.find(({ interfaceId }) => interfaceId === candidate.interfaceId);
    const content = {
      interfaceId: candidate.interfaceId,
      boundaryRevisionId: design.revisionId,
      profileRevisionId: profile.revisionId,
      adapter: candidate.adapter,
      formalContract: {
        ...candidate.formalContract,
        documents: candidate.formalContract.documents.map((document) => ({
          path: document.path,
          mediaType: document.mediaType,
          content: document.content,
          sha256: sha256Text(document.content),
        })),
      },
      normalizedIndex: candidate.normalizedIndex,
    };
    const priorContent = prior == null
      ? null
      : {
          interfaceId: prior.interfaceId,
          boundaryRevisionId: prior.boundaryRevisionId,
          profileRevisionId: prior.profileRevisionId,
          adapter: prior.adapter,
          formalContract: prior.formalContract,
          normalizedIndex: prior.normalizedIndex,
        };
    return prior != null && fingerprint(priorContent) === fingerprint(content)
      ? prior
      : { ...revisionMetadata(prior), ...content };
  });
  const subjectContracts = proposal.subjectContracts.map((candidate) => {
    const prior = previous?.subjectContracts.find(({ subjectId }) => subjectId === candidate.subjectId);
    const interfaceContractRevisionIds = candidate.interfaceIds.map((interfaceId) => {
      const contract = interfaceContracts.find((item) => item.interfaceId === interfaceId);
      if (contract == null) throw new Error(`Missing interface contract for ${interfaceId}.`);
      return contract.revisionId;
    });
    const content = {
      subjectId: candidate.subjectId,
      boundaryRevisionId: design.revisionId,
      profileRevisionId: profile.revisionId,
      interfaceContractRevisionIds,
      protocol: candidate.protocol,
      harness: candidate.harness,
    };
    const priorContent = prior == null
      ? null
      : {
          subjectId: prior.subjectId,
          boundaryRevisionId: prior.boundaryRevisionId,
          profileRevisionId: prior.profileRevisionId,
          interfaceContractRevisionIds: prior.interfaceContractRevisionIds,
          protocol: prior.protocol,
          harness: prior.harness,
        };
    return prior != null && fingerprint(priorContent) === fingerprint(content)
      ? prior
      : { ...revisionMetadata(prior), ...content };
  });
  const verificationContracts = proposal.verificationContracts.map((candidate) => {
    const prior = previous?.verificationContracts.find(
      ({ verificationObligationId }) => verificationObligationId === candidate.verificationObligationId,
    );
    const content = {
      verificationObligationId: candidate.verificationObligationId,
      boundaryRevisionId: design.revisionId,
      profileRevisionId: profile.revisionId,
      environment: candidate.environment,
      stimulus: candidate.stimulus,
      evidenceSchema: candidate.evidenceSchema,
      passMatchers: candidate.passMatchers,
    };
    const priorContent = prior == null
      ? null
      : {
          verificationObligationId: prior.verificationObligationId,
          boundaryRevisionId: prior.boundaryRevisionId,
          profileRevisionId: prior.profileRevisionId,
          environment: prior.environment,
          stimulus: prior.stimulus,
          evidenceSchema: prior.evidenceSchema,
          passMatchers: prior.passMatchers,
        };
    return prior != null && fingerprint(priorContent) === fingerprint(content)
      ? prior
      : { ...revisionMetadata(prior), ...content };
  });
  return {
    id: previous?.id ?? uuid(),
    revisionId: uuid(),
    revision: (previous?.revision ?? 0) + 1,
    createdAt: now,
    boundaryRevisionId: design.revisionId,
    profileRevisionId: profile.revisionId,
    interfaceContracts,
    subjectContracts,
    verificationContracts,
  };
}

export function applyContractSuiteProposal(
  store: FlatStore,
  proposal: ContractSuiteProposal,
): void {
  requireApproved(store, store.boundaryDesign, "boundary design");
  requireApproved(store, store.implementationProfile, "implementation profile");
  if (
    store.implementationProfile.boundaryRevisionId !==
    store.boundaryDesign.revisionId
  ) {
    throw new Error(
      "The implementation profile is bound to a stale boundary-design revision.",
    );
  }
  const suite = materializeContractSuite(
    proposal,
    store.boundaryDesign,
    store.implementationProfile,
    store.contractSuite,
  );
  validateContractSuite(suite, store.boundaryDesign, store.implementationProfile.revisionId);
  const revisionDiff = store.contractSuite == null
    ? null
    : formatContractSuiteDiff(store.contractSuite, suite);
  applyAtomically(
    store,
    (candidate) => {
      candidate.setContractSuite(suite);
      candidate.acknowledgeInputs(WorkflowStage.InterfaceContracts);
    },
    "Apply the reconciled formal-contract revision.",
  );
  store.setContractRevisionDiff(revisionDiff);
}

function resolveDependencies(
  items: readonly { key: string; id?: string; dependencies: string[] }[],
): Map<string, { id: string; dependencies: string[] }> {
  const ids = new Map(items.map((item) => [item.key, item.id ?? uuid()]));
  return new Map(items.map((item) => [
    item.key,
    {
      id: ids.get(item.key)!,
      dependencies: item.dependencies.map((key) => {
        const id = ids.get(key);
        if (id == null) throw new Error(`Unknown proposal dependency ${key}.`);
        return id;
      }),
    },
  ]));
}

/**
 * A list item keeps its revision identity exactly while its content is
 * unchanged; any change, however small, mints a new revision.
 */
function revisionIdentity(
  prior: { revisionId: string; revision: number } | undefined,
  same: boolean,
): { revisionId: string; revision: number } {
  return prior != null && same
    ? { revisionId: prior.revisionId, revision: prior.revision }
    : { revisionId: uuid(), revision: (prior?.revision ?? 0) + 1 };
}

export function applyTestScenarioProposal(
  store: FlatStore,
  proposal: TestScenarioListProposal,
): void {
  if (!store.stageIsComplete(WorkflowStage.InterfaceContracts)) {
    throw new UserFacingError("Approve the implementation profile and every formal contract first.");
  }
  const resolved = resolveDependencies(proposal.items);
  const previous = new Map(store.testScenarios.map((item) => [item.id, item]));
  const generatedFromEmpty = previous.size === 0;
  const snapshots: TestScenarioSnapshotInput[] = proposal.items.map((item) => {
    const identity = resolved.get(item.key)!;
    const prior = previous.get(identity.id);
    const references = item.acceptanceCriteriaIds.map((id) => ({ id, type: StructuralFragment.AcceptanceCriteria }));
    const content = {
      title: item.title,
      description: item.description,
      references,
      dependencies: identity.dependencies,
      binding: item.binding,
    };
    const same = prior != null && fingerprint(content) === fingerprint({
      title: prior.content,
      description: prior.description,
      references: prior.references.map(({ id, type }) => ({ id, type })),
      dependencies: [...prior.dependencies],
      binding: prior.binding,
    });
    return {
      id: identity.id,
      title: item.title,
      description: item.description,
      priority: item.priority as Priority,
      references,
      dependencies: identity.dependencies,
      binding: item.binding,
      ...revisionIdentity(prior, same),
      approval: prior?.approval ?? null,
      verdict: prior?.verdict ?? null,
      basis: store.currentBasisOf({
        type: StructuralFragment.TestScenario,
        references,
        binding: item.binding,
      }),
      testCases: prior?.testCases.map((testCase) => getSnapshot(testCase)),
    };
  });
  applyAtomically(
    store,
    (candidate) => {
      candidate.setTestScenarios(snapshots);
      if (generatedFromEmpty) candidate.acknowledgeInputs(WorkflowStage.TestScenarios);
    },
    "Apply the new revision-bound scenario set.",
  );
}

export function applyTestCaseProposal(store: FlatStore, proposal: TestCaseListProposal): void {
  const scenario = store.testScenarios.find(({ id }) => id === proposal.scenarioId);
  if (scenario == null) throw new Error(`Missing scenario ${proposal.scenarioId}.`);
  const resolved = resolveDependencies(proposal.items);
  const previous = new Map(scenario.testCases.map((item) => [item.id, item]));
  const generatedFromEmpty = store.testCases.length === 0;
  const cases: TestCaseSnapshotInput[] = proposal.items.map((item) => {
    const identity = resolved.get(item.key)!;
    const prior = previous.get(identity.id);
    const references = [
      { id: scenario.id, type: StructuralFragment.TestScenario },
      ...item.acceptanceCriteriaIds.map((id) => ({ id, type: StructuralFragment.AcceptanceCriteria })),
    ];
    const content = {
      title: item.title,
      description: item.description,
      definition: item.definition,
      references,
      dependencies: identity.dependencies,
    };
    const same = prior != null && fingerprint(content) === fingerprint({
      title: prior.title,
      description: prior.description,
      definition: prior.definition,
      references: prior.references.map(({ id, type }) => ({ id, type })),
      dependencies: [...prior.dependencies],
    });
    return {
      id: identity.id,
      title: item.title,
      description: item.description,
      priority: item.priority as Priority,
      references,
      dependencies: identity.dependencies,
      definition: item.definition,
      ...revisionIdentity(prior, same),
      approval: prior?.approval ?? null,
      verdict: prior?.verdict ?? null,
      basis: store.currentBasisOf({ type: StructuralFragment.TestCase, references }),
      generatedInputFingerprint: prior?.generatedInputFingerprint,
    };
  });
  applyAtomically(
    store,
    (candidate) => {
      candidate.replaceTestCases(proposal.scenarioId, cases);
      if (generatedFromEmpty) candidate.acknowledgeInputs(WorkflowStage.TestCases);
    },
    `Apply regenerated cases for ${scenario.content}.`,
  );
}

export function applyProjectSetupProposal(
  store: FlatStore,
  proposal: ProjectSetupProposal,
): void {
  requireApproved(store, store.boundaryDesign, "boundary design");
  requireApproved(store, store.implementationProfile, "implementation profile");
  if (store.contractSuite == null || !store.stageIsComplete(WorkflowStage.InterfaceContracts)) {
    throw new UserFacingError("An approved contract suite is required before project setup.");
  }
  const setup: ProjectSetup = { ...revisionMetadata(store.projectSetup ?? undefined), ...proposal };
  validateProjectSetup(
    setup,
    store.boundaryDesign,
    store.implementationProfile,
    store.contractSuite,
    store.testDesignFingerprint,
    new Set(store.testScenarios.map(({ id }) => id)),
  );
  applyAtomically(
    store,
    (candidate) => {
      candidate.setProjectSetup(setup);
      candidate.acknowledgeInputs(WorkflowStage.ProjectSetup);
    },
    "Replace the project setup and scaffold manifest.",
  );
}

/**
 * Lead the error details with the actual failure reason (message plus any
 * wrapped causes), then the raw stack. A bare stack trace names framework
 * frames but hides what went wrong; the reason is what an operator needs.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const lines = [`${error.name}: ${error.message}`];
  let cause: unknown = error.cause;
  while (cause instanceof Error && lines.length < 5) {
    lines.push(`Caused by: ${cause.message}`);
    cause = cause.cause;
  }
  const stack = error.stack ?? "";
  return stack.length > 0 ? `${lines.join("\n")}\n\n${stack}` : lines.join("\n");
}

/**
 * Review the stage a flow acted on (the frontier for a conversation turn)
 * once its work is applied. A reviewer failure leaves the work in place
 * and says so; it never fails the flow that wrote the work.
 */
async function reviewAfterFlow(
  store: FlatStore,
  target: WorkflowStage | null,
  signal: AbortSignal,
): Promise<void> {
  const reviewed = target ?? store.frontier;
  if (reviewed == null || store.pendingImpactChange != null) return;
  const { reviewStageUnits } = await import("ai-agent/reviewer");
  try {
    await reviewStageUnits(store, reviewed);
  } catch (error) {
    if (signal.aborted) return;
    store.setValidationError({
      message: `The reviewer model could not review ${store.stageLabel(reviewed)}: ${getUserFacingErrorMessage(error, "the request failed")}. Run the review again.`,
    });
  }
}

/** The store action each flow is assigned to; the store wiring binds it. */
const flowActionNames = new WeakMap<object, string>();

/**
 * Record the store action a flow is assigned to, so a failed attempt can
 * name the call that repeats it. Property keys survive minification,
 * function names do not.
 */
export function bindFlowAction(flowFunction: object, actionName: string): void {
  flowActionNames.set(flowFunction, actionName);
}

export function generator<
  const U extends unknown[],
  Requirements extends string & keyof SnapshotOrInstance<FlatStore>,
  Yield extends PromiseLike<unknown>,
  Next,
>(
  function_: (
    store: Omit<FlatStore, Requirements> & {
      [key in Requirements]: NonNullable<FlatStore[key]>;
    },
    ...args: U
  ) => Generator<Yield, void, Next>,
  {
    operation,
    requirements = [],
    targetStep,
    reviewAfter = true,
  }: {
    operation: string;
    requirements?: readonly Requirements[];
    /**
     * Whether the reviewer model reviews the acted-on stage once the flow
     * succeeds. Every flow that writes work does; the review flow itself
     * does not.
     */
    reviewAfter?: boolean;
    /**
     * The workflow stage this flow acts on, or a derivation from its
     * arguments, or null for conversation with no stage target. Every
     * stage-targeted flow is gated on upstream work here, so no flow
     * can act downstream of unapproved work by forgetting a check. The
     * option is required so a new flow fails to compile ungated.
     */
    targetStep: WorkflowStage | ((...args: U) => WorkflowStage) | null;
  },
) {
  const flowFn = flow(function* (
    store: FlatStore,
    ...args: U
  ): Generator<Yield, void, Next> {
    if (store.isBusy) return;
    const action = flowActionNames.get(flowFn);
    if (action == null) throw new Error(`Unable to ${operation}: the flow is not a store action.`);

    let incrementedBusinessCounter = false;
    let abortController: AbortController | null = null;
    try {
      store.resetValidationErrors();
      store.pendingRetry = null;

      function throwEmptyError(requirement: Requirements) {
        throw new UserFacingError(
          `Complete ${String(requirement)} before trying to ${operation}.`,
        );
      }

      requirements.forEach((requirement) => {
        const value: unknown = store[requirement];
        if (Array.isArray(value)) {
          if (value.length === 0) throwEmptyError(requirement);
        } else if (value instanceof Set || value instanceof Map) {
          if (value.size === 0) throwEmptyError(requirement);
        } else if (typeof value === "string") {
          if (value.trim().length === 0) throwEmptyError(requirement);
        } else if (
          value &&
          typeof value === "object" &&
          "isComplete" in value &&
          value.isComplete === false
        ) {
          throwEmptyError(requirement);
        } else if (!value) {
          throwEmptyError(requirement);
        }
      });

      const target = typeof targetStep === "function"
        ? (targetStep as (...args: U) => WorkflowStage)(...args)
        : targetStep;
      if (target != null) {
        const blockerReason = store.stageBlockerReason(
          target,
          `before trying to ${operation}`,
        );
        if (blockerReason != null) throw new UserFacingError(blockerReason);
      }

      store.businessCounter += 1;
      incrementedBusinessCounter = true;
      abortController = new AbortController();
      store.beginAiOperation({ operation, controller: abortController });
      yield* function_(
        store as Omit<FlatStore, Requirements> & {
          [key in Requirements]: NonNullable<FlatStore[key]>;
        },
        ...args,
      );
      if (reviewAfter) {
        yield reviewAfterFlow(store, target, abortController.signal) as unknown as Yield;
      }
    } catch (error) {
      if (abortController?.signal.aborted) return;
      // Expected rule failures speak for themselves in the UI and need no
      // diagnostics; only unexpected failures log and carry details. Rate
      // limits and timeouts are handled too: one calm sentence with a
      // retry, and the attempt waits for it instead of a console entry.
      if (error instanceof UserFacingError) {
        store.setValidationError({ message: error.message });
      } else {
        const retryMessage = isRateLimitError(error)
          ? "The AI provider hit its rate limit. Wait a moment, then try again."
          : isTimeoutError(error)
            ? "The AI request timed out. Wait a moment, then try again."
            : null;
        if (retryMessage != null) {
          store.pendingRetry = { action, args };
          store.setValidationError({ message: retryMessage });
        } else {
          console.error(`Unable to ${operation}.`, error);
          store.setValidationError({
            message: getUserFacingErrorMessage(
              error,
              `Unable to ${operation}. Please try again.`,
            ),
            details: process.env.NODE_ENV === "development"
              ? describeError(error)
              : undefined,
          });
        }
      }
    } finally {
      if (abortController != null) {
        store.endAiOperation();
      }
      if (incrementedBusinessCounter) {
        store.businessCounter = Math.max(0, store.businessCounter - 1);
      }
    }
  });

  // Declare this operation as a timeline step. The tag carries the label;
  // the store wiring supplies the action name it is assigned to (property
  // keys survive minification, function names do not).
  return Object.assign(flowFn, {
    __timelineStep: { kind: "ai" as const, label: operation },
  });
}
