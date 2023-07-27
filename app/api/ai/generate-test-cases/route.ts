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

export interface GenerateTestCasesRequestBody extends RequestBody {
  testScenarioIndex: number;
}

export async function POST(request: Request) {
  const { state, testScenarioIndex } =
    (await request.json()) as GenerateTestCasesRequestBody;

  try {
    const result = await queryAiModel([
      systemPrompt,
      `current state: ${state}`,
      ...generatePrompt(StructuralFragment.acceptanceCriteria),
      "Ensure that each test case is concise, focused on the specific scenario, and avoids redundancy. It should include steps needed to be done to complete the test case. Do not include steps that are irrelevant or contradict the test scenario.",
      `Remember to cover edge cases and various combinations of inputs while keeping the test steps clear and straightforward. Trying to cover edge cases and various combinations of inputs shouldn't cause you to generate inputs/edge cases that are not in compliance with the test scenario.`,
      `Remember to not cover cases that belong to other test scenarios.`,
      `Sample of good test cases (in this sample we separate test cases with "---" but you don't need it when you use the function call, also we are only including the first test case's steps):
Addition of two small positive integers
Steps:
1. Input the first small positive integer into the calculator.
2. Click on the "+" button.
3. Input the second small positive integer into the calculator.
4. Click on the "=" button.
5. Verify that the result displayed on the calculator is the sum of the two input integers.
---
Addition of two large positive integers
Steps:
...
---
Addition of a positive integer and a positive decimal number
Steps:
...
---
Addition of the largest possible positive integers
Steps:
...
---
Addition of a positive integer and the smallest possible positive decimal
Steps:
...

These are good because they cover general use cases, edge cases and different combinations while not covering anything beyond the obligations of their test scenario. It also uses new line after the title of each test case and after "Steps:" and after each step.`,
      "Ensure that the created test cases are not designed in such a manner that they can be integrated into other test scenarios.",
      ...generatePrompt(StructuralFragment.testCase),
      `Only focus on generating test cases specifically for test scenario #${testScenarioIndex + 1
      }`,
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
