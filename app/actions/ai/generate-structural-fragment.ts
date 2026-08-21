"use server";
import "server-only";

import { runStructuredHarnessTask } from "actions/lib/harness";
import {
  buildArtifactStagePrompt,
  buildSystemPrompt,
} from "ai-harness/prompts";
import { buildArtifactListTool } from "ai-harness/tools";
import { parseArtifactListProposal } from "ai-harness/validation";
import { getArtifactStageDefinition } from "ai-harness/workflow";
import { parseJsonObject } from "lib/json";
import { ActionParameters } from "lib/types";
import { StructuralFragment } from "store/constants";
import { isEnumMember } from "utilities";

export interface GenerateStructuralFragmentParameters extends ActionParameters {
  structuralFragment: StructuralFragment;
}

export async function generateStructuralFragment({
  state,
  structuralFragment,
}: GenerateStructuralFragmentParameters) {
  const parsedState = parseJsonObject(state, "Project state");
  if (!isEnumMember(structuralFragment, StructuralFragment)) {
    throw new Error("Invalid structural fragment type.");
  }
  const definition = getArtifactStageDefinition(structuralFragment);
  const operation = `generate ${structuralFragment.replaceAll("_", " ")}`;
  return runStructuredHarnessTask({
    operation,
    systemPrompt: buildSystemPrompt({ operation, role: definition.role }),
    userPrompt: buildArtifactStagePrompt({
      definition,
      state: parsedState,
    }),
    resultTool: buildArtifactListTool({
      definition,
      state: parsedState,
    }),
    parseResult: (value) =>
      parseArtifactListProposal(value, {
        expectedEntityType: structuralFragment,
        state: parsedState,
      }),
  });
}
