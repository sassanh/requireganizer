"use server";
import "server-only";

import { runStructuredHarnessTask } from "actions/lib/harness";
import { buildSystemPrompt, buildTestCasePrompt } from "ai-harness/prompts";
import { buildTestCaseListTool } from "ai-harness/tools";
import type { BoundaryDesign, ContractSuite, TestScenarioBinding } from "contract-domain";
import { parseTestCaseListProposal, validateTestCaseDefinition } from "contract-domain";
import { parseJsonObject } from "lib/json";
import type { ActionParameters } from "lib/types";
import { EngineerRole } from "store/constants";

import { assertApprovedContractContext } from "./contract-context";

interface ScenarioInput {
  id: string;
  revisionId: string;
  title: string;
  description: string;
  acceptanceCriteriaIds: string[];
  binding: TestScenarioBinding;
}

interface Parameters extends ActionParameters {
  design: BoundaryDesign;
  suite: ContractSuite;
  scenario: ScenarioInput;
  existingIds?: string[];
}

export async function generateContractTestCases({
  state,
  design,
  suite,
  scenario,
  existingIds = [],
}: Parameters) {
  assertApprovedContractContext(design, suite);
  const parsedState = parseJsonObject(state, "Project state");
  const operation = "generate test cases";
  return runStructuredHarnessTask({
    operation,
    systemPrompt: buildSystemPrompt({ operation, role: EngineerRole.SoftwareTestEngineer }),
    userPrompt: buildTestCasePrompt({ state: parsedState, design, suite, scenario }),
    resultTool: buildTestCaseListTool({
      design,
      suite,
      binding: scenario.binding,
      scenarioRevisionId: scenario.revisionId,
      acceptanceCriteriaIds: scenario.acceptanceCriteriaIds,
      existingIds,
    }),
    parseResult: (value) => {
      const proposal = parseTestCaseListProposal(
        value,
        scenario.id,
        existingIds,
      );
      const allowedCriteria = new Set(scenario.acceptanceCriteriaIds);
      for (const item of proposal.items) {
        for (const id of item.acceptanceCriteriaIds) {
          if (!allowedCriteria.has(id)) throw new Error(`Test case ${item.key} references acceptance criterion ${id} outside its scenario.`);
        }
        validateTestCaseDefinition(
          item.definition,
          scenario.binding,
          design,
          suite,
          scenario.revisionId,
        );
      }
      for (const id of scenario.acceptanceCriteriaIds) {
        if (!proposal.items.some((item) => item.acceptanceCriteriaIds.includes(id))) {
          throw new Error(`Test case proposal does not cover acceptance criterion ${id}.`);
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
