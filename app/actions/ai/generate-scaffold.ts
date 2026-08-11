"use server";
import "server-only";

import { runStructuredHarnessTask } from "actions/lib/harness";
import {
  buildScaffoldPrompt,
  buildSystemPrompt,
} from "ai-harness/prompts";
import { buildScaffoldTool } from "ai-harness/tools";
import { parseScaffoldProposal } from "ai-harness/validation";
import { expectRecord, parseJsonObject } from "lib/json";
import { EngineerRole } from "store/constants";

export async function generateScaffold({
  config,
  state,
}: {
  config: Record<string, unknown>;
  state: string;
}) {
  const validatedConfig = expectRecord(config, "Project configuration");
  const parsedState = parseJsonObject(state, "Project state");
  const operation = "generate project scaffold";
  return runStructuredHarnessTask({
    operation,
    systemPrompt: buildSystemPrompt({
      operation,
      role: EngineerRole.SoftwareDeveloper,
    }),
    userPrompt: buildScaffoldPrompt({
      state: parsedState,
      config: validatedConfig,
    }),
    resultTool: buildScaffoldTool(),
    parseResult: parseScaffoldProposal,
  });
}
