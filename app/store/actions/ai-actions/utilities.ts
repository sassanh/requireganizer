import { SnapshotOrInstance, applySnapshot, clone, flow, getSnapshot } from "mobx-state-tree";

import {
  ArtifactListProposal,
  FragmentRevisionProposal,
  ProductOverviewProposal,
  ProjectConfigurationProposal,
  ScaffoldProposal,
  TestCodeProposal,
} from "ai-harness/contracts";
import { getArtifactStageDefinition } from "ai-harness/workflow";
import { getUserFacingErrorMessage, UserFacingError } from "lib/errors";
import { HarnessResult } from "lib/types";
import { STEP_LABELS, Status, Step } from "store/constants";
import type { FlatStore } from "store/store";

function applyAtomically(
  store: FlatStore,
  update: (candidate: FlatStore) => void,
): void {
  const candidate = clone(store);
  update(candidate);
  applySnapshot(store, getSnapshot(candidate));
}

export function consumeHarnessResult<Value>(
  store: FlatStore,
  result: HarnessResult<Value>,
): Value | null {
  store.recordProviderCalls(result.metadata.providerCalls);
  if (result.status === "needs_input") {
    store.communicate({ description: result.message });
    return null;
  }
  if (result.status === "error") {
    store.setValidationError({
      message: result.message,
      details: result.details,
    });
    return null;
  }
  return result.value;
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

export function applyProjectConfigurationProposal(
  store: FlatStore,
  proposal: ProjectConfigurationProposal,
): void {
  applyAtomically(store, (candidate) => {
    candidate.setProjectConfig(JSON.stringify(proposal, null, 2));
    candidate.setProjectConfigLocked(false);
    candidate.setScaffoldFiles([]);
    candidate.markProjectConfigCurrent();
    candidate.setProjectConfigDialogOpen(true);
  });
}

export function applyScaffoldProposal(
  store: FlatStore,
  proposal: ScaffoldProposal,
): void {
  applyAtomically(store, (candidate) => {
    candidate.setScaffoldFiles(proposal.files);
    candidate.setProjectConfigLocked(true);
    candidate.communicate({
      description: "Scaffold generated successfully in the virtual filesystem.",
    });
  });
}

export function applyTestCodeProposal(
  store: FlatStore,
  proposal: TestCodeProposal,
  testCaseId: string,
  generatedAt = Date.now(),
): void {
  applyAtomically(store, (candidate) => {
    candidate.setScaffoldFile(proposal.path, proposal.code);
    for (const scenario of candidate.testScenarios) {
      const testCase = scenario.testCases.find(({ id }) => id === testCaseId);
      if (testCase != null) {
        testCase.setLastGeneratedAt(generatedAt);
        return;
      }
    }
    throw new Error(`Cannot mark missing test case ${testCaseId} as generated.`);
  });
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
    try {
      store.resetValidationErrors();

      function throwEmptyError(requirement: Requirements) {
        throw new UserFacingError(
          `Complete ${String(requirement)} before trying to ${operation}.`,
        );
      }

      requirements.forEach((requirement) => {
        const value = store[requirement];
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
      yield* function_(
        store as Omit<FlatStore, Requirements> & {
          [key in Requirements]: NonNullable<FlatStore[key]>;
        },
        ...args,
      );
    } catch (error) {
      console.error(`Unable to ${operation}.`, error);
      store.setValidationError({
        message: getUserFacingErrorMessage(
          error,
          `Unable to ${operation}. Please try again.`,
        ),
        details:
          process.env.NODE_ENV === "development"
            ? error instanceof Error
              ? error.stack ?? `${error.name}: ${error.message}`
              : String(error)
            : undefined,
      });
    } finally {
      if (incrementedBusinessCounter) {
        store.businessCounter = Math.max(0, store.businessCounter - 1);
      }
    }
  });
}
