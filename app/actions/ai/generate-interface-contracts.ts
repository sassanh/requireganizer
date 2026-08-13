"use server";
import "server-only";

import { runStructuredHarnessTask } from "actions/lib/harness";
import { buildContractSuitePrompt, buildSystemPrompt } from "ai-harness/prompts";
import { buildContractSuiteTool } from "ai-harness/tools";
import type {
  BoundaryDesign,
  ContractSuite,
  ContractSuiteProposal,
  ImplementationProfile,
} from "contract-domain";
import {
  fingerprint,
  parseContractSuiteProposal,
  validateContractSuite,
  validateContractSuiteProposal,
  validateImplementationProfile,
} from "contract-domain";
import { parseJsonObject } from "lib/json";
import type { ActionParameters } from "lib/types";
import { EngineerRole } from "store/constants";

interface Parameters extends ActionParameters {
  design: BoundaryDesign;
  profile: ImplementationProfile;
  currentSuite?: ContractSuite;
  revisionTarget?: { kind: "interface" | "subject" | "verification"; id: string };
  comment?: string;
}

function assertRevisionIsolation(
  proposal: ContractSuiteProposal,
  current: ContractSuite,
  design: BoundaryDesign,
  target: NonNullable<Parameters["revisionTarget"]>,
): void {
  const targetSemanticId =
    target.kind === "interface"
      ? current.interfaceContracts.find(({ id }) => id === target.id)?.interfaceId
      : target.kind === "subject"
        ? current.subjectContracts.find(({ id }) => id === target.id)?.subjectId
        : current.verificationContracts.find(({ id }) => id === target.id)
            ?.verificationObligationId;
  if (targetSemanticId == null) {
    throw new Error(`The selected ${target.kind} contract no longer exists.`);
  }

  for (const candidate of proposal.interfaceContracts) {
    if (target.kind === "interface" && candidate.interfaceId === targetSemanticId) {
      continue;
    }
    const existing = current.interfaceContracts.find(
      ({ interfaceId }) => interfaceId === candidate.interfaceId,
    );
    if (
      existing == null ||
      fingerprint({
        interfaceId: candidate.interfaceId,
        adapter: candidate.adapter,
        formalContract: {
          ...candidate.formalContract,
          documents: candidate.formalContract.documents.map(
            ({ sha256: _sha256, ...document }) => document,
          ),
        },
        normalizedIndex: candidate.normalizedIndex,
      }) !==
        fingerprint({
          interfaceId: existing.interfaceId,
          adapter: existing.adapter,
          formalContract: {
            ...existing.formalContract,
            documents: existing.formalContract.documents.map(
              ({ sha256: _sha256, ...document }) => document,
            ),
          },
          normalizedIndex: existing.normalizedIndex,
        })
    ) {
      throw new Error(
        `The revision changed non-target interface contract ${candidate.interfaceId}.`,
      );
    }
  }

  for (const candidate of proposal.subjectContracts) {
    if (target.kind === "subject" && candidate.subjectId === targetSemanticId) {
      continue;
    }
    const existing = current.subjectContracts.find(
      ({ subjectId }) => subjectId === candidate.subjectId,
    );
    const existingInterfaceIds = design.interfaces
      .filter(({ subjectId }) => subjectId === candidate.subjectId)
      .map(({ id }) => id);
    if (
      existing == null ||
      fingerprint(candidate) !==
        fingerprint({
          subjectId: existing.subjectId,
          interfaceIds: existingInterfaceIds,
          protocol: existing.protocol,
          harness: existing.harness,
        })
    ) {
      throw new Error(
        `The revision changed non-target subject contract ${candidate.subjectId}.`,
      );
    }
  }

  for (const candidate of proposal.verificationContracts) {
    if (
      target.kind === "verification" &&
      candidate.verificationObligationId === targetSemanticId
    ) {
      continue;
    }
    const existing = current.verificationContracts.find(
      ({ verificationObligationId }) =>
        verificationObligationId === candidate.verificationObligationId,
    );
    if (
      existing == null ||
      fingerprint(candidate) !==
        fingerprint({
          verificationObligationId: existing.verificationObligationId,
          environment: existing.environment,
          stimulus: existing.stimulus,
          evidenceSchema: existing.evidenceSchema,
          passMatchers: existing.passMatchers,
        })
    ) {
      throw new Error(
        `The revision changed non-target verification contract ${candidate.verificationObligationId}.`,
      );
    }
  }
}

export async function generateInterfaceContracts({
  state,
  design,
  profile,
  currentSuite,
  revisionTarget,
  comment,
}: Parameters) {
  if (design.status !== "approved") throw new Error("Boundary design must be approved.");
  if (profile.status !== "approved") throw new Error("Implementation profile must be approved.");
  validateImplementationProfile(profile, design.revisionId);
  if (currentSuite != null) {
    if (revisionTarget == null) {
      throw new Error("A formal-contract revision requires one exact target.");
    }
    validateContractSuite(currentSuite, design, profile.revisionId);
  }
  const parsedState = parseJsonObject(state, "Project state");
  const operation = currentSuite ? "revise interface contract" : "generate interface contracts";
  return runStructuredHarnessTask({
    operation,
    systemPrompt: buildSystemPrompt({ operation, role: EngineerRole.SoftwareDeveloper }),
    userPrompt: buildContractSuitePrompt({
      state: parsedState,
      design,
      profile,
      currentSuite,
      revisionTarget,
      comment,
    }),
    resultTool: buildContractSuiteTool(design),
    parseResult: (value) => {
      const proposal = parseContractSuiteProposal(value);
      validateContractSuiteProposal(proposal, design, profile.revisionId);
      if (currentSuite != null && revisionTarget != null) {
        assertRevisionIsolation(proposal, currentSuite, design, revisionTarget);
      }
      return proposal;
    },
    ...(currentSuite == null
      ? {}
      : {
        bindingMetadata: {
          adapterIds: currentSuite.interfaceContracts.map(({ adapter }) => `${adapter.id}@${adapter.version}`),
          interfaceContractRevisionIds: currentSuite.interfaceContracts.map(({ revisionId }) => revisionId),
          subjectContractRevisionIds: currentSuite.subjectContracts.map(({ revisionId }) => revisionId),
        },
      }),
  });
}
