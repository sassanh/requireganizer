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
  generateStructuralFragmentPrompt,
  generateSystemPrompt,
  queryAiModel,
} from "../lib";

export const runtime = "edge";

export interface GenerateStructuralFragmentRequestBody extends RequestBody {
  structuralFragment: StructuralFragment;
  parentId?: string;
}

export async function POST(request: Request) {
  const { state, structuralFragment, parentId } =
    (await request.json()) as GenerateStructuralFragmentRequestBody;

  try {
    const result = await queryAiModel([
      generateSystemPrompt(
        ENGINEER_ROLE_BY_ITERATION[
          ITERATION_BY_STRUCTURAL_FRAGMENT[structuralFragment]
        ]
      ),
      `current state: ${state}`,
      ...generateStructuralFragmentPrompt(structuralFragment),
      ...{
        [StructuralFragment.userStory]: [
          'Each user story should start with "As a"',
        ],
        [StructuralFragment.requirement]: [],
        [StructuralFragment.acceptanceCriteria]: [],
        [StructuralFragment.testScenario]: [
          // TODO: Other types of tests previously done by human are now possible using AI models.
          // For example analysing the look of the app to check if the user interface is simple enough using image
          // processing models, so we are not limited to running traditional automated tests.
          "Test execution will be performed by machines. In this stage you are asked to only generate the test scenario titles without the test cases. Generating test cases will be done later in a separate request.",
        ],
        [StructuralFragment.testCase]: [
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
          `Only focus on generating test cases specifically for test scenario with id ${parentId}`,
        ],
        [StructuralFragment.testCode]: [],
      }[structuralFragment],
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
