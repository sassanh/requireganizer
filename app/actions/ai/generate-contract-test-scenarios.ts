"use server";
import "server-only";

import { runStructuredHarnessTask } from "actions/lib/harness";
import { buildSystemPrompt, buildTestScenarioPrompt } from "ai-harness/prompts";
import { buildTestScenarioListTool } from "ai-harness/tools";
import type { BoundaryDesign, ContractSuite } from "contract-domain";
import {
  parseTestScenarioListProposal,
  validateScenarioAcceptanceCriteria,
  validateScenarioBinding,
} from "contract-domain";
import { parseJsonObject } from "lib/json";
import type { ActionParameters } from "lib/types";
import { EngineerRole } from "store/constants";

import { artifactIds, assertApprovedContractContext } from "./contract-context";

interface Parameters extends ActionParameters {
  design: BoundaryDesign;
  suite: ContractSuite;
  existingIds?: string[];
}

export async function generateContractTestScenarios({
  state,
  design,
  suite,
  existingIds = [],
}: Parameters) {
  assertApprovedContractContext(design, suite);
  const parsedState = parseJsonObject(state, "Project state");
  const acceptanceCriteriaIds = artifactIds(parsedState, "acceptanceCriteria");
  const operation = "generate test scenarios";
  return runStructuredHarnessTask({
    operation,
    systemPrompt: buildSystemPrompt({ operation, role: EngineerRole.SoftwareTestEngineer }),
    userPrompt: buildTestScenarioPrompt({ state: parsedState, design, suite }),
    resultTool: buildTestScenarioListTool(
      design,
      suite,
      acceptanceCriteriaIds,
      existingIds,
    ),
    parseResult: (value) => {
      const proposal = parseTestScenarioListProposal(value, existingIds);
      const allowedCriteria = new Set(acceptanceCriteriaIds);
      for (const item of proposal.items) {
        validateScenarioBinding(item.binding, design, suite);
        validateScenarioAcceptanceCriteria(
          item.acceptanceCriteriaIds,
          item.binding,
          design,
        );
        for (const id of item.acceptanceCriteriaIds) {
          if (!allowedCriteria.has(id)) throw new Error(`Scenario ${item.key} references unknown acceptance criterion ${id}.`);
        }
      }
      for (const id of acceptanceCriteriaIds) {
        if (!proposal.items.some((item) => item.acceptanceCriteriaIds.includes(id))) {
          throw new Error(`Test scenario proposal does not cover acceptance criterion ${id}.`);
        }
      }
      return proposal;
    },
    bindingMetadata: {
      adapterIds: suite.interfaceContracts.map(({ adapter }) => `${adapter.id}@${adapter.version}`),
      interfaceContractRevisionIds: suite.interfaceContracts.map(({ revisionId }) => revisionId),
      subjectContractRevisionIds: suite.subjectContracts.map(({ revisionId }) => revisionId),
    },
  });
}
