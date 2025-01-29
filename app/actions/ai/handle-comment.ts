"use server";
import "server-only";
import {
  ENGINEER_ROLE_BY_ITERATION,
  ITERATION_BY_STRUCTURAL_FRAGMENT,
  StructuralFragment,
} from "store";

import {
  AIModelError,
  generateSystemPrompt,
  queryAiModel,
} from "actions/lib/openai";
import { ActionParameters, ActionReturnValue } from "lib/types";

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
}: HandleCommentParameters): Promise<ActionReturnValue> {
  try {
    const result = await queryAiModel([
      generateSystemPrompt(
        ENGINEER_ROLE_BY_ITERATION[
          ITERATION_BY_STRUCTURAL_FRAGMENT[structuralFragment]
        ],
      ),
      `current state:] ${state}`,
      `Regarding ${structuralFragment} with id ${id} consider this comment: """${comment}""".`,
    ]);

    return { functionCall: result };
  } catch (error) {
    if (error instanceof AIModelError) {
      throw error;
    }
    console.error(error);
    throw new Error("Unexpected error while handling comment");
  }
}
