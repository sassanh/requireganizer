"use server";
import "server-only";

import { runStructuredHarnessTask } from "actions/lib/harness";
import { buildBoundaryDesignPrompt, buildSystemPrompt } from "ai-harness/prompts";
import { buildBoundaryDesignTool } from "ai-harness/tools";
import type { BoundaryDesign } from "contract-domain";
import {
  parseBoundaryDesignProposal,
  validateBoundaryDesign,
} from "contract-domain";
import { parseJsonObject } from "lib/json";
import type { ActionParameters } from "lib/types";
import { EngineerRole } from "store/constants";

import { artifactIds } from "./contract-context";

interface Parameters extends ActionParameters {
  currentDesign?: BoundaryDesign;
  comment?: string;
}

export async function generateBoundaryDesign({ state, currentDesign, comment }: Parameters) {
  const parsedState = parseJsonObject(state, "Project state");
  const requirementIds = artifactIds(parsedState, "requirements");
  const acceptanceCriteriaIds = artifactIds(parsedState, "acceptanceCriteria");
  const operation = currentDesign ? "revise boundary design" : "generate boundary design";
  return runStructuredHarnessTask({
    operation,
    systemPrompt: buildSystemPrompt({ operation, role: EngineerRole.SoftwareTestEngineer }),
    userPrompt: buildBoundaryDesignPrompt({
      state: parsedState,
      currentDesign,
      comment,
    }),
    resultTool: buildBoundaryDesignTool({ requirementIds, acceptanceCriteriaIds }),
    parseResult: (value) => {
      const proposal = parseBoundaryDesignProposal(value);
      validateBoundaryDesign(proposal, {
        requirementIds: new Set(requirementIds),
        acceptanceCriteriaIds: new Set(acceptanceCriteriaIds),
      });
      return proposal;
    },
  });
}
