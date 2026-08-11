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

interface GenerateStructuralFragmentParameters extends ActionParameters {
  structuralFragment: StructuralFragment;
  parentId?: string;
}

export async function generateStructuralFragment({
  state,
  structuralFragment,
  parentId,
}: GenerateStructuralFragmentParameters) {
  const parsedState = parseJsonObject(state, "Project state");
  if (!isEnumMember(structuralFragment, StructuralFragment)) {
    throw new Error("Invalid structural fragment type.");
  }
  if (structuralFragment === StructuralFragment.TestCase && !parentId) {
    throw new Error("Test-case generation requires a parent scenario.");
  }
  if (structuralFragment !== StructuralFragment.TestCase && parentId != null) {
    throw new Error("Only test-case generation accepts a parent scenario.");
  }

  const definition = getArtifactStageDefinition(structuralFragment);
  const operation = `generate ${structuralFragment.replaceAll("_", " ")}`;
  return runStructuredHarnessTask({
    operation,
    systemPrompt: buildSystemPrompt({ operation, role: definition.role }),
    userPrompt: buildArtifactStagePrompt({
      definition,
      state: parsedState,
      parentId,
    }),
    resultTool: buildArtifactListTool({
      definition,
      state: parsedState,
      parentId,
    }),
    parseResult: (value) =>
      parseArtifactListProposal(value, {
        expectedEntityType: structuralFragment,
        expectedParentId: parentId,
        state: parsedState,
      }),
  });
}
