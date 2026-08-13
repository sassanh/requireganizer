"use server";
import "server-only";

import { runStructuredHarnessTask } from "actions/lib/harness";
import { buildProjectSetupPrompt, buildSystemPrompt } from "ai-harness/prompts";
import { buildProjectSetupTool } from "ai-harness/tools";
import type {
  BoundaryDesign,
  ContractSuite,
  ImplementationProfile,
  ProjectSetup,
} from "contract-domain";
import {
  parseProjectSetupProposal,
  validateProjectSetup,
} from "contract-domain";
import { parseJsonObject } from "lib/json";
import type { ActionParameters } from "lib/types";
import { EngineerRole } from "store/constants";

import { assertApprovedContractContext } from "./contract-context";

interface Parameters extends ActionParameters {
  design: BoundaryDesign;
  profile: ImplementationProfile;
  suite: ContractSuite;
  scenarioIds: string[];
  testDesignFingerprint: string;
}

export async function generateProjectSetup({
  state,
  design,
  profile,
  suite,
  scenarioIds,
  testDesignFingerprint,
}: Parameters) {
  assertApprovedContractContext(design, suite, profile);
  const parsedState = parseJsonObject(state, "Project state");
  const operation = "generate project setup";
  return runStructuredHarnessTask({
    operation,
    systemPrompt: buildSystemPrompt({ operation, role: EngineerRole.SoftwareDeveloper }),
    userPrompt: buildProjectSetupPrompt({
      state: parsedState,
      design,
      profile,
      suite,
      testDesignFingerprint,
    }),
    resultTool: buildProjectSetupTool({
      design,
      profile,
      suite,
      scenarioIds,
      testDesignFingerprint,
    }),
    parseResult: (value) => {
      const proposal = parseProjectSetupProposal(value);
      const candidate: ProjectSetup = {
        id: "project-setup-proposal",
        revisionId: "project-setup-proposal-revision",
        revision: 1,
        status: "draft",
        createdAt: "1970-01-01T00:00:00.000Z",
        ...proposal,
      };
      validateProjectSetup(
        candidate,
        design,
        profile,
        suite,
        testDesignFingerprint,
        new Set(scenarioIds),
      );
      return proposal;
    },
    bindingMetadata: {
      adapterIds: suite.interfaceContracts.map(({ adapter }) => `${adapter.id}@${adapter.version}`),
      interfaceContractRevisionIds: suite.interfaceContracts.map(({ revisionId }) => revisionId),
      subjectContractRevisionIds: suite.subjectContracts.map(({ revisionId }) => revisionId),
    },
  });
}
