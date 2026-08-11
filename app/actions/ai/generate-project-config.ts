"use server";
import "server-only";

import { runStructuredHarnessTask } from "actions/lib/harness";
import {
  buildProjectConfigurationPrompt,
  buildSystemPrompt,
} from "ai-harness/prompts";
import { buildProjectConfigurationTool } from "ai-harness/tools";
import { parseProjectConfigurationProposal } from "ai-harness/validation";
import { parseJsonObject } from "lib/json";
import { ActionParameters } from "lib/types";
import { EngineerRole } from "store/constants";

export async function generateProjectConfig({ state }: ActionParameters) {
  const parsedState = parseJsonObject(state, "Project state");
  const operation = "generate project configuration";
  return runStructuredHarnessTask({
    operation,
    systemPrompt: buildSystemPrompt({
      operation,
      role: EngineerRole.SoftwareDeveloper,
    }),
    userPrompt: buildProjectConfigurationPrompt(parsedState),
    resultTool: buildProjectConfigurationTool(),
    parseResult: parseProjectConfigurationProposal,
  });
}
