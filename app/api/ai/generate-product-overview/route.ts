import { NextResponse } from "next/server";

import { ENGINEER_ROLE_BY_ITERATION, Iteration } from "store";

import {
  AIModelError,
  RequestBody,
  ResponseBody,
  generateSystemPrompt,
  queryAiModel,
} from "../lib";

export const runtime = "edge";

export async function POST(request: Request) {
  const { state } = (await request.json()) as RequestBody;

  try {
    const result = await queryAiModel([
      generateSystemPrompt(
        ENGINEER_ROLE_BY_ITERATION[Iteration.productOverview]
      ),
      `current state: ${state}`,
      "If the description is valid and enough, generate a product overview for the software, highlighting its primary features, target users, and benefits. It is important to avoid guessing the intention of the description and stick with its explicit message. Call the error function if the description is not valid or is not enough.",
      "If the description is alright, you should also set the framework and the programming language.",
    ]);

    return NextResponse.json<ResponseBody>({
      functionCall: result,
    });
  } catch (error) {
    if (error instanceof AIModelError) {
      return NextResponse.json({ message: error.message }, { status: 502 });
    }
  }
}
