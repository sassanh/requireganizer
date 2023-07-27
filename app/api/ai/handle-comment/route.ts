import { NextResponse } from "next/server";

import { StructuralFragment } from "@/store";

import {
  AIModelError,
  RequestBody,
  ResponseBody,
  queryAiModel,
  systemPrompt,
} from "../lib";

export interface HandleCommentRequestBody extends RequestBody {
  comment: string;
  type: StructuralFragment;
  id: string;
}

export async function POST(request: Request) {
  const { state, comment, type, id } =
    (await request.json()) as HandleCommentRequestBody;

  try {
    const result = await queryAiModel([
      systemPrompt,
      `current state: ${state}`,
      `Regarding ${type} with id ${id} consider this comment: """ ${comment} """. To address this comment please run the required function.`,
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
