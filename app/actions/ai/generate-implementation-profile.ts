"use server";
import "server-only";

import { runStructuredHarnessTask } from "actions/lib/harness";
import { buildImplementationProfilePrompt, buildSystemPrompt } from "ai-harness/prompts";
import { buildImplementationProfileTool } from "ai-harness/tools";
import { parseImplementationProfileProposal } from "contract-domain";
import { parseJsonObject } from "lib/json";
import type { ActionParameters } from "lib/types";
import { EngineerRole } from "store/constants";

export async function generateImplementationProfile({ state }: ActionParameters) {
  const parsedState = parseJsonObject(state, "Project state");
  const operation = "generate implementation profile";
  return runStructuredHarnessTask({
    operation,
    systemPrompt: buildSystemPrompt({ operation, role: EngineerRole.SoftwareDeveloper }),
    userPrompt: buildImplementationProfilePrompt(parsedState),
    resultTool: buildImplementationProfileTool(),
    parseResult: parseImplementationProfileProposal,
  });
}
