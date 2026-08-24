import { SnapshotOrInstance, applySnapshot, clone, flow, getSnapshot } from "mobx-state-tree";

import {
  ArtifactListProposal,
  FragmentRevisionProposal,
  ProductOverviewProposal,
  TestCodeProposal,
} from "ai-harness/contracts";
import { getArtifactStageDefinition } from "ai-harness/workflow";
import type {
  BoundaryDesign,
  BoundaryDesignProposal,
  ContractSuite,
  ContractSuiteProposal,
  ImplementationProfile,
  ImplementationProfileProposal,
  ProjectSetup,
  ProjectSetupProposal,
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
import { Priority, STEP_LABELS, Status, Step, StructuralFragment } from "store/constants";
import type { FlatStore, TestCaseSnapshotInput, TestScenarioSnapshotInput } from "store/store";
import { setTimelineSource } from "store/timeline/controller";
import { uuid } from "utilities";

export function applyAtomically(
  store: FlatStore,
  update: (candidate: FlatStore) => void,
  impact?: {
    sourceStep: Step;
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
      sourceLabel: impact.sourceLabel ?? STEP_LABELS[impact.sourceStep],
      affectedSteps,
      affectedArtifacts: affectedSteps.map((step) => ({
        step,
        label: `${STEP_LABELS[step]} artifacts`,
        reason: `These artifacts consume ${impact.sourceLabel ?? STEP_LABELS[impact.sourceStep]} and will remain viewable but stale until regenerated.`,
      })),
      summary: impact.summary,
      candidateSnapshot: snapshot,
    });
    return;
  }
  applySnapshot(store, snapshot);
}

export function applyProductOverviewProposal(
  store: FlatStore,
  proposal: ProductOverviewProposal,
): void {
  applyAtomically(store, (candidate) => {
    candidate.initialize(proposal);
    candidate.markStageGenerated(Step.ProductOverview);
  });
}

export function applyArtifactListProposal(
  store: FlatStore,
  proposal: ArtifactListProposal,
): void {
  applyArtifactListProposals(store, [proposal]);
}

export function applyArtifactListProposals(
  store: FlatStore,
  proposals: ArtifactListProposal[],
): void {
  applyAtomically(store, (candidate) => {
    const completedSteps = new Set<Step>();
    proposals.forEach((proposal) => {
      const definition = getArtifactStageDefinition(proposal.entityType);
      candidate.replaceArtifactList(proposal);
      completedSteps.add(definition.step);
    });
    completedSteps.forEach((step) => candidate.markStageGenerated(step));
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

function revisionMetadata(previous?: { id: string; revision: number }) {
  return {
    id: previous?.id ?? uuid(),
    revisionId: uuid(),
    revision: (previous?.revision ?? 0) + 1,
    // No manual approval flow exists: generated artifacts are immediately
    // considered final until a newer revision replaces them.
    status: "approved" as const,
    createdAt: new Date().toISOString(),
    approvedAt: new Date().toISOString(),
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
      : { sourceStep: Step.BoundaryDesign, summary: "Apply the new boundary-design revision." },
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
  if (store.boundaryDesign == null) {
    throw new Error("An approved boundary design is required before implementation profiling.");
  }
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
        sourceStep: Step.InterfaceContracts,
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
  if (store.boundaryDesign == null || store.implementationProfile == null) {
    throw new Error("Approved boundary design and implementation profile are required.");
  }
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
        sourceStep: Step.InterfaceContracts,
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
  const resolved = resolveDependencies(proposal.items);
  const previous = new Map(store.testScenarios.map((item) => [item.id, item]));
  const snapshots: TestScenarioSnapshotInput[] = proposal.items.map((item) => {
    const identity = resolved.get(item.key)!;
    const prior = previous.get(identity.id);
    return {
      id: identity.id,
      title: item.title,
      description: item.description,
      priority: item.priority as Priority,
      references: item.acceptanceCriteriaIds.map((id) => ({ id, type: StructuralFragment.AcceptanceCriteria })),
      dependencies: identity.dependencies,
      binding: item.binding,
      revisionId: uuid(),
      revision: (prior?.revision ?? 0) + 1,
      testCases: prior?.testCases.map((testCase) => getSnapshot(testCase)),
    };
  });
  applyAtomically(
    store,
    (candidate) => {
      candidate.setTestScenarios(snapshots);
      candidate.markStageGenerated(Step.TestScenarios);
    },
    store.testScenarios.length === 0
      ? undefined
      : { sourceStep: Step.TestScenarios, summary: "Apply the new revision-bound scenario set." },
  );
}

export function applyTestCaseProposal(store: FlatStore, proposal: TestCaseListProposal): void {
  const scenario = store.testScenarios.find(({ id }) => id === proposal.scenarioId);
  if (scenario == null) throw new Error(`Missing scenario ${proposal.scenarioId}.`);
  const resolved = resolveDependencies(proposal.items);
  const previous = new Map(scenario.testCases.map((item) => [item.id, item]));
  const cases: TestCaseSnapshotInput[] = proposal.items.map((item) => {
    const identity = resolved.get(item.key)!;
    const prior = previous.get(identity.id);
    return {
      id: identity.id,
      title: item.title,
      description: item.description,
      priority: item.priority as Priority,
      references: [
        { id: scenario.id, type: StructuralFragment.TestScenario },
        ...item.acceptanceCriteriaIds.map((id) => ({ id, type: StructuralFragment.AcceptanceCriteria })),
      ],
      dependencies: identity.dependencies,
      definition: item.definition,
      revisionId: uuid(),
      revision: (prior?.revision ?? 0) + 1,
      generatedInputFingerprint: prior?.generatedInputFingerprint,
    };
  });
  applyAtomically(
    store,
    (candidate) => {
      candidate.replaceTestCases(proposal.scenarioId, cases);
      candidate.markStageGenerated(Step.TestCases);
    },
    scenario.testCases.length === 0
      ? undefined
      : { sourceStep: Step.TestCases, summary: `Apply regenerated cases for ${scenario.content}.` },
  );
}

export function applyProjectSetupProposal(
  store: FlatStore,
  proposal: ProjectSetupProposal,
): void {
  if (
    store.boundaryDesign == null ||
    store.implementationProfile == null ||
    store.contractSuite == null
  ) {
    throw new Error(
      "Approved contracts and an implementation profile are required before project setup.",
    );
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
      : { sourceStep: Step.ProjectSetup, summary: "Replace the project setup and scaffold manifest." },
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
    requiredSteps?: readonly Step[];
  },
) {
  return flow(function* (
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
        if (status === Status.Completed) return;
        const action = status === Status.Outdated ? "Regenerate" : "Complete";
        throw new UserFacingError(
          `${action} ${STEP_LABELS[step]} before trying to ${operation}.`,
        );
      });

      store.businessCounter += 1;
      incrementedBusinessCounter = true;
      abortController = new AbortController();
      store.beginAiOperation({ operation, controller: abortController });
      setTimelineSource({ kind: "ai", label: operation });
      try {
        yield* function_(
          store as Omit<FlatStore, Requirements> & {
            [key in Requirements]: NonNullable<FlatStore[key]>;
          },
          ...args,
        );
      } finally {
        setTimelineSource(null);
      }
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
}
