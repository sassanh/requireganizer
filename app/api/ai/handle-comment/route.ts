import { NextResponse } from "next/server";

import {
  ENGINEER_ROLE_BY_ITERATION,
  ITERATION_BY_STRUCTURAL_FRAGMENT,
  StructuralFragment,
} from "store";

import {
  AIModelError,
  RequestBody,
  ResponseBody,
  generateSystemPrompt,
  queryAiModel,
} from "../lib";

export interface HandleCommentRequestBody extends RequestBody {
  comment: string;
  structuralFragment: StructuralFragment;
  id: string;
}

export async function POST(request: Request) {
  const { state, comment, structuralFragment, id } =
    (await request.json()) as HandleCommentRequestBody;

  try {
    const result = await queryAiModel([
      generateSystemPrompt(
        ENGINEER_ROLE_BY_ITERATION[
          ITERATION_BY_STRUCTURAL_FRAGMENT[structuralFragment]
        ]
      ),
      `current state:] ${state}`,
      `Regarding ${structuralFragment} with id ${id} consider this comment: """${comment}""".`,
    ]);

    return NextResponse.json<ResponseBody>({
      functionCall: result,
    });
  } catch (error) {
    if (error instanceof AIModelError) {
      return NextResponse.json({ message: error.message }, { status: 502 });
    }
    console.error(error);
  }
}
