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
      ...generatePrompt(StructuralFragment.acceptanceCriteria),
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
