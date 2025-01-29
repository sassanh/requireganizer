"use server";
import "server-only";
import { ENGINEER_ROLE_BY_ITERATION, Iteration } from "store";

import {
  AIModelError,
  generateSystemPrompt,
  queryAiModel,
} from "actions/lib/openai";
import { ActionParameters, ActionReturnValue } from "lib/types";

export async function generateProductOverview({
  state,
}: ActionParameters): Promise<ActionReturnValue> {
  try {
    const result = await queryAiModel([
      generateSystemPrompt(
        ENGINEER_ROLE_BY_ITERATION[Iteration.productOverview],
      ),
      `current state: ${state}`,
      "If the description is valid and enough, generate a product overview for the software, highlighting its primary features, target users, and benefits. It is important to avoid guessing the intention of the description and stick with its explicit message. Call the error function if the description is not valid or is not enough.",
      "If the description is alright, you should also set the framework and the programming language.",
    ]);

    return { functionCall: result };
  } catch (error) {
    if (error instanceof AIModelError) {
      throw error;
    }
    console.error(error);
    throw new Error("Unexpected error while generating product overview");
  }
}
