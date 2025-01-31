"use server";
import "server-only";

import {
  AIModelError,
  generateSystemPrompt,
  queryAiModel,
} from "actions/lib/prompts";
import { ActionParameters, ActionReturnValue } from "lib/types";
import { ENGINEER_ROLE_BY_ITERATION, Iteration } from "store";

export async function generateProductOverview({
  state,
}: ActionParameters): Promise<ActionReturnValue> {
  try {
    const result = await queryAiModel([
      generateSystemPrompt(
        ENGINEER_ROLE_BY_ITERATION[Iteration.productOverview],
      ),
      `current state: ${state}`,
      `Analyze the provided description and determine if it is valid and sufficient to generate a structured product overview. Follow these rules strictly:
  
- Do NOT infer unstated intentions. Only use explicit details from the description.
- If the description is incomplete, ambiguous, or nonsensical, call the \`communicate\` function and stop processing.
- If the description is valid, generate a structured product overview containing:
- **Name**: The software’s name as provided. If not provided already, choose a good catchy name relevant to the provided information following best practices of naming.
- **Purpose**: A clear and concise statement of what the software does.
- **Primary Features**: A list of key functionalities derived directly from the description.
- **Target Users**: Who will use this software, if mentioned.
- **Programming Language**: The most suitable programming language based on the described functionality.
- **Framework**: The most appropriate framework, if applicable.

Ensure that the generated product overview follows a formalized structure, making it ready for further processing by the software factory.`,
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
