"use server";
import "server-only";

import { runStructuredHarnessTask } from "actions/lib/harness";
import {
  buildProductOverviewPrompt,
  buildSystemPrompt,
} from "ai-harness/prompts";
import { buildProductOverviewTool } from "ai-harness/tools";
import { parseProductOverviewProposal } from "ai-harness/validation";
import { parseJsonObject } from "lib/json";
import { ActionParameters } from "lib/types";
import {
  ENGINEER_ROLE_BY_STEP,
  EngineerRole,
  Step,
} from "store/constants";

export async function generateProductOverview({ state }: ActionParameters) {
  const parsedState = parseJsonObject(state, "Project state");
  const operation = "generate product overview";
  return runStructuredHarnessTask({
    operation,
    systemPrompt: buildSystemPrompt({
      operation,
      role:
        ENGINEER_ROLE_BY_STEP[Step.ProductOverview][0] ??
        EngineerRole.RequirementsEngineer,
    }),
    userPrompt: buildProductOverviewPrompt(parsedState),
    resultTool: buildProductOverviewTool(),
    parseResult: parseProductOverviewProposal,
  });
}
