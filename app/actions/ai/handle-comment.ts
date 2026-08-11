"use server";
import "server-only";

import { runStructuredHarnessTask } from "actions/lib/harness";
import {
  buildFragmentRevisionPrompt,
  buildSystemPrompt,
} from "ai-harness/prompts";
import { buildFragmentRevisionTool } from "ai-harness/tools";
import { parseFragmentRevisionProposal } from "ai-harness/validation";
import { parseJsonObject } from "lib/json";
import { ActionParameters } from "lib/types";
import {
  ENGINEER_ROLE_BY_STEP,
  EngineerRole,
  STEP_BY_STRUCTURAL_FRAGMENT,
  StructuralFragment,
} from "store/constants";
import { isEnumMember } from "utilities";

export interface HandleCommentParameters extends ActionParameters {
  comment: string;
  structuralFragment: StructuralFragment;
  id: string;
}

export async function handleComment({
  state,
  comment,
  structuralFragment,
  id,
}: HandleCommentParameters) {
  const parsedState = parseJsonObject(state, "Project state");
  if (!isEnumMember(structuralFragment, StructuralFragment)) {
    throw new Error("Invalid structural fragment type.");
  }
  if (comment.trim().length === 0 || id.trim().length === 0) {
    throw new Error("A comment and fragment id are required.");
  }

  const operation = `revise ${structuralFragment.replaceAll("_", " ")}`;
  const step = STEP_BY_STRUCTURAL_FRAGMENT[structuralFragment];
  return runStructuredHarnessTask({
    operation,
    systemPrompt: buildSystemPrompt({
      operation,
      role:
        ENGINEER_ROLE_BY_STEP[step][0] ?? EngineerRole.RequirementsEngineer,
    }),
    userPrompt: buildFragmentRevisionPrompt({
      state: parsedState,
      entityType: structuralFragment,
      id,
      comment,
    }),
    resultTool: buildFragmentRevisionTool(structuralFragment),
    parseResult: (value) =>
      parseFragmentRevisionProposal(value, {
        expectedEntityType: structuralFragment,
        expectedId: id,
      }),
  });
}
