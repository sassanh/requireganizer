import { NextResponse } from "next/server";

import { StructuralFragment } from "@/store";

import {
  AIModelError,
  RequestBody,
  ResponseBody,
  generatePrompt,
  queryAiModel,
  systemPrompt,
} from "../lib";

export async function POST(request: Request) {
  const { state } = (await request.json()) as RequestBody;

  try {
    const result = await queryAiModel([
      systemPrompt,
      `current state: ${state}`,
      ...generatePrompt(StructuralFragment.testScenario),
      // TODO: Other types of tests previously done by human are now possible using AI models.
      // For example analysing the look of the app to check if the user interface is simple enough using image
      // processing models, so we are not limited to running traditional automated tests.
      "Test execution will be performed by machines. In this stage you are asked to only generate the test scenario titles without the test cases. Generating test cases will be done later in a separate request.",
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
