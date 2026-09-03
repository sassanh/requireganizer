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
import { getUserFacingErrorMessage, UserFacingError } from "lib/errors";
import { HarnessResult } from "lib/types";
import { assertApproved } from "store/approval";
import {
  OVERVIEW_NAME_QUALITY_ID,
  OVERVIEW_PURPOSE_QUALITY_ID,
  Priority,
  WORKFLOW_STAGE_LABELS,
  Status,
  WorkflowStage,
  StructuralFragment,
} from "store/constants";
import { classifyListChange } from "store/listChange";
import {
  dependenciesEqual,
  referencesEqual,
} from "store/models/StructuralFragment";
import type { FlatStore, TestCaseSnapshotInput, TestScenarioSnapshotInput } from "store/store";
import { uuid } from "utilities";

interface PriorItemState {
  approval: ApprovalStatus;
  lastSignedContent: string | null;
  content: string;
}

/**
 * Approval for a rewritten item whose human-authored fields are unchanged.
 * Identical content keeps its state, and content matching the last approved
 * text restores approval — there is nothing left to review.
 */
function approvalForUnchangedItem(
  prior: PriorItemState,
  nextContent: string,
): { approval: ApprovalStatus; lastSignedContent: string | null } {
  const signed =
    prior.lastSignedContent ??
    (prior.approval === "approved" ? prior.content : null);
  const reapproved = signed != null && nextContent === signed;
  return {
    approval: reapproved ? "approved" : prior.approval,
    lastSignedContent: reapproved ? null : prior.lastSignedContent,
  };
}

/** Last-approved text for a rewritten item, mirroring fragment dropApproval. */
function signedContentOf(prior: PriorItemState | null): string | null {
  if (prior == null) return null;
  return (
    prior.lastSignedContent ??
    (prior.approval === "approved" ? prior.content : null)
  );
}

export function applyAtomically(
  store: FlatStore,
  update: (candidate: FlatStore) => void,
  impact?: {
    sourceStep: WorkflowStage;
    sourceLabel?: string;
    summary: string;
    includeSourceStep?: boolean;
  },
): void {
  const candidate = clone(store);
  update(candidate);
  const snapshot = getSnapshot(candidate);
  const affectedSteps = impact == null
    ? []
    : store.affectedDownstreamSteps(
      impact.sourceStep,
      impact.includeSourceStep,
    );
  if (impact != null && affectedSteps.length > 0) {
    store.queueImpactChange({
      sourceStep: impact.sourceStep,
      sourceLabel: impact.sourceLabel ?? WORKFLOW_STAGE_LABELS[impact.sourceStep],
      affectedSteps,
      affectedArtifacts: affectedSteps.map((step) => ({
        step,
        label: `${WORKFLOW_STAGE_LABELS[step]} artifacts`,
        reason: `These artifacts consume ${impact.sourceLabel ?? WORKFLOW_STAGE_LABELS[impact.sourceStep]} and will remain viewable but stale until regenerated.`,
      })),
      summary: impact.summary,
      candidateSnapshot: snapshot,
    });
    return;
  }
  applySnapshot(store, snapshot);
}

export type ArtifactApplyOptions = {
  markGenerated?: boolean;
};

export function applyProductOverviewProposal(
  store: FlatStore,
  proposal: ProductOverviewProposal,
  options: ArtifactApplyOptions = {},
): void {
  const markGenerated = options.markGenerated ?? true;
  applyAtomically(store, (candidate) => {
    const overview = candidate.productOverview;
    const before = [
      { id: OVERVIEW_NAME_QUALITY_ID, code: "Name" },
      { id: OVERVIEW_PURPOSE_QUALITY_ID, code: "Purpose" },
      ...overview.primaryFeatures.map((item) => ({
        id: item.id,
        code: item.getCode(),
      })),
      ...overview.targetUsers.map((item) => ({
        id: item.id,
        code: item.getCode(),
      })),
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
    const featureSnapshots = proposal.primaryFeatures.map(toFeatureSnapshot);
    for (const existing of overview.primaryFeatures) {
      if (proposedFeatureIds.has(existing.id)) continue;
      existing.markPendingRemoval();
      featureSnapshots.push(getSnapshot(existing));
    }
    const userSnapshots = proposal.targetUsers.map(toUserSnapshot);
    for (const existing of overview.targetUsers) {
      if (proposedUserIds.has(existing.id)) continue;
      existing.markPendingRemoval();
      userSnapshots.push(getSnapshot(existing));
    }
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
        { id: OVERVIEW_NAME_QUALITY_ID, lastSignedContent: overview.lastSignedName },
        { id: OVERVIEW_PURPOSE_QUALITY_ID, lastSignedContent: overview.lastSignedPurpose },
        ...overview.primaryFeatures.map((item) => ({
          id: item.id,
          lastSignedContent: item.lastSignedContent,
          pendingRemoval: item.pendingRemoval,
        })),
        ...overview.targetUsers.map((item) => ({
          id: item.id,
          lastSignedContent: item.lastSignedContent,
          pendingRemoval: item.pendingRemoval,
        })),
      ]),
    );
    if (markGenerated) candidate.markStageGenerated(WorkflowStage.ProductOverview);
  });
}

export function applyArtifactListProposal(
  store: FlatStore,
  proposal: ArtifactListProposal,
  options: ArtifactApplyOptions = {},
): void {
  applyArtifactListProposals(store, [proposal], options);
}

export function applyArtifactListProposals(
  store: FlatStore,
  proposals: ArtifactListProposal[],
  options: ArtifactApplyOptions = {},
): void {
  const markGenerated = options.markGenerated ?? true;
  applyAtomically(store, (candidate) => {
    const completedSteps = new Set<WorkflowStage>();
    proposals.forEach((proposal) => {
      const definition = getArtifactStageDefinition(proposal.entityType);
      candidate.replaceArtifactList(proposal);
      completedSteps.add(definition.step);
    });
    completedSteps.forEach((step) => {
      if (markGenerated) candidate.markStageGenerated(step);
    });
  });
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
    status: "draft",
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
    requirementsRevisionId: fingerprint(
      store.requirements.map((item) => getSnapshot(item)),
    ),
    acceptanceCriteriaRevisionId: fingerprint(
      store.acceptanceCriteria.map((item) => getSnapshot(item)),
    ),
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
    (candidate) => candidate.setBoundaryDesign(design),
    store.boundaryDesign == null
      ? undefined
      : { sourceStep: WorkflowStage.BoundaryDesign, summary: "Apply the new boundary-design revision." },
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
  assertApproved(store.boundaryDesign, "boundary design");
  const profile = materializeImplementationProfile(
    proposal,
    store.boundaryDesign.revisionId,
    store.implementationProfile,
  );
  applyAtomically(
    store,
    (candidate) => candidate.setImplementationProfile(profile),
    store.implementationProfile == null
      ? undefined
      : {
        sourceStep: WorkflowStage.InterfaceContracts,
        sourceLabel: "Implementation Profile",
        summary: "Apply the new implementation-profile revision.",
        includeSourceStep: true,
      },
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
  assertApproved(store.boundaryDesign, "boundary design");
  assertApproved(store.implementationProfile, "implementation profile");
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
    (candidate) => candidate.setContractSuite(suite),
    store.contractSuite == null
      ? undefined
      : {
        sourceStep: WorkflowStage.InterfaceContracts,
        sourceLabel: "Formal Contracts",
        summary: "Apply the reconciled formal-contract revision.",
        includeSourceStep: true,
      },
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

export function applyTestScenarioProposal(
  store: FlatStore,
  proposal: TestScenarioListProposal,
): void {
  if (!store.stageIsApproved(WorkflowStage.InterfaceContracts)) {
    throw new Error("Approve the implementation profile and every formal contract first.");
  }
  const resolved = resolveDependencies(proposal.items);
  const previous = new Map(store.testScenarios.map((item) => [item.id, item]));
  // A rewrite that changes nothing — same members, same wording, same
  // bindings — applies silently instead of queueing a phantom impact
  // confirmation for downstream stages.
  let changed = proposal.items.length !== previous.size;
  const snapshots: TestScenarioSnapshotInput[] = proposal.items.map((item) => {
    const identity = resolved.get(item.key)!;
    const prior = previous.get(identity.id);
    const references = item.acceptanceCriteriaIds.map((id) => ({ id, type: StructuralFragment.AcceptanceCriteria }));
    const textSame =
      prior != null &&
      item.title === prior.content &&
      item.description === prior.description &&
      referencesEqual(references, prior.references) &&
      dependenciesEqual(identity.dependencies, prior.dependencies);
    const bindingSame =
      prior != null &&
      fingerprint(item.binding) === fingerprint(prior.binding);
    // Unchanged wording, or wording back on the last approved text: there
    // is nothing left to review.
    const signed = signedContentOf(prior ?? null);
    const matchesSigned =
      prior != null && signed != null && item.title === signed;
    if (prior == null || (!textSame && !matchesSigned) || !bindingSame) {
      changed = true;
    }
    if (prior == null || (!textSame && !matchesSigned)) {
      return {
        id: identity.id,
        title: item.title,
        description: item.description,
        priority: item.priority as Priority,
        references,
        dependencies: identity.dependencies,
        binding: item.binding,
        revisionId: uuid(),
        revision: (prior?.revision ?? 0) + 1,
        approval: "draft",
        lastSignedContent: signedContentOf(prior ?? null),
        testCases: prior?.testCases.map((testCase) => getSnapshot(testCase)),
      };
    }
    // Human-authored fields unchanged: keep review state, and only mint a
    // new revision when the contract binding genuinely moved.
    return {
      id: identity.id,
      title: item.title,
      description: item.description,
      priority: item.priority as Priority,
      references,
      dependencies: identity.dependencies,
      binding: item.binding,
      revisionId: bindingSame ? prior.revisionId : uuid(),
      revision: bindingSame ? prior.revision : prior.revision + 1,
      ...approvalForUnchangedItem(prior, item.title),
      testCases: prior.testCases.map((testCase) => getSnapshot(testCase)),
    };
  });
  applyAtomically(
    store,
    (candidate) => {
      candidate.setTestScenarios(snapshots);
      candidate.markStageGenerated(WorkflowStage.TestScenarios);
    },
    store.testScenarios.length === 0 || !changed
      ? undefined
      : { sourceStep: WorkflowStage.TestScenarios, summary: "Apply the new revision-bound scenario set." },
  );
}

export function applyTestCaseProposal(store: FlatStore, proposal: TestCaseListProposal): void {
  const scenario = store.testScenarios.find(({ id }) => id === proposal.scenarioId);
  if (scenario == null) throw new Error(`Missing scenario ${proposal.scenarioId}.`);
  const resolved = resolveDependencies(proposal.items);
  const previous = new Map(scenario.testCases.map((item) => [item.id, item]));
  // A rewrite that changes nothing applies silently instead of queueing a
  // phantom impact confirmation for downstream stages.
  let changed = proposal.items.length !== previous.size;
  const cases: TestCaseSnapshotInput[] = proposal.items.map((item) => {
    const identity = resolved.get(item.key)!;
    const prior = previous.get(identity.id);
    const references = [
      { id: scenario.id, type: StructuralFragment.TestScenario },
      ...item.acceptanceCriteriaIds.map((id) => ({ id, type: StructuralFragment.AcceptanceCriteria })),
    ];
    const textSame =
      prior != null &&
      item.title === prior.title &&
      item.description === prior.content &&
      fingerprint(item.definition) === fingerprint(prior.definition) &&
      referencesEqual(references, prior.references) &&
      dependenciesEqual(identity.dependencies, prior.dependencies);
    // Wording back on the last approved text restores approval, like the
    // fragment models do. A pure revert applies silently.
    const signed = signedContentOf(prior ?? null);
    const matchesSigned =
      prior != null && signed != null && item.description === signed;
    if (prior == null || (!textSame && !matchesSigned)) changed = true;
    if (prior == null || (!textSame && !matchesSigned)) {
      return {
        id: identity.id,
        title: item.title,
        description: item.description,
        priority: item.priority as Priority,
        references,
        dependencies: identity.dependencies,
        definition: item.definition,
        revisionId: uuid(),
        revision: (prior?.revision ?? 0) + 1,
        approval: "draft",
        lastSignedContent: signedContentOf(prior ?? null),
        generatedInputFingerprint: prior?.generatedInputFingerprint,
      };
    }
    // Definition and wording unchanged: keep review state and revision, so
    // generated tests stay in sync instead of phantom-going stale.
    return {
      id: identity.id,
      title: item.title,
      description: item.description,
      priority: item.priority as Priority,
      references,
      dependencies: identity.dependencies,
      definition: item.definition,
      revisionId: prior.revisionId,
      revision: prior.revision,
      ...approvalForUnchangedItem(prior, item.description),
      generatedInputFingerprint: prior.generatedInputFingerprint,
    };
  });
  applyAtomically(
    store,
    (candidate) => {
      candidate.replaceTestCases(proposal.scenarioId, cases);
      candidate.markStageGenerated(WorkflowStage.TestCases);
    },
    scenario.testCases.length === 0 || !changed
      ? undefined
      : { sourceStep: WorkflowStage.TestCases, summary: `Apply regenerated cases for ${scenario.content}.` },
  );
}

export function applyProjectSetupProposal(
  store: FlatStore,
  proposal: ProjectSetupProposal,
): void {
  assertApproved(store.boundaryDesign, "boundary design");
  assertApproved(store.implementationProfile, "implementation profile");
  if (store.contractSuite == null || !store.stageIsApproved(WorkflowStage.InterfaceContracts)) {
    throw new Error("An approved contract suite is required before project setup.");
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
    (candidate) => candidate.setProjectSetup(setup),
    store.projectSetup == null
      ? undefined
      : { sourceStep: WorkflowStage.ProjectSetup, summary: "Replace the project setup and scaffold manifest." },
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
    requiredSteps = [],
  }: {
    operation: string;
    requirements?: readonly Requirements[];
    requiredSteps?: readonly WorkflowStage[];
  },
) {
  const flowFn = flow(function* (
    store: FlatStore,
    ...args: U
  ): Generator<Yield, void, Next> {
    if (store.isBusy) return;

    let incrementedBusinessCounter = false;
    let abortController: AbortController | null = null;
    try {
      store.resetValidationErrors();

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

      requiredSteps.forEach((step) => {
        const status = store.getStepStatus(step);
        if (status !== Status.Completed) {
          if (status === Status.Outdated) {
            throw new UserFacingError(
              `Regenerate ${WORKFLOW_STAGE_LABELS[step]} before trying to ${operation}.`,
            );
          }
          const blocker = store.firstPendingPredecessor(step) ?? step;
          throw new UserFacingError(
            `Complete ${WORKFLOW_STAGE_LABELS[blocker]} before trying to ${operation}.`,
          );
        }
        if (!store.stageIsApproved(step)) {
          throw new UserFacingError(
            `Approve ${WORKFLOW_STAGE_LABELS[step]} before trying to ${operation}.`,
          );
        }
      });

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
    } catch (error) {
      if (abortController?.signal.aborted) return;
      console.error(`Unable to ${operation}.`, error);
      store.setValidationError({
        message: getUserFacingErrorMessage(
          error,
          `Unable to ${operation}. Please try again.`,
        ),
        details:
          process.env.NODE_ENV === "development"
            ? describeError(error)
            : undefined,
      });
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
