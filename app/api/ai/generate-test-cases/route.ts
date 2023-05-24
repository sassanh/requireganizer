import { SnapshotIn, SnapshotOut } from "mobx-state-tree";
import { NextResponse } from "next/server";

import {
  AcceptanceCriteria,
  Requirement,
  TestCase,
  TestScenario,
  UserStory,
} from "@/store/models";

import { ai, generatePrompt, prepareContent, systemPrompt } from "../lib";

export interface GenerateTestCasesRequestBody {
  description: string;
  productOverview: string;
  userStories: SnapshotOut<UserStory>[];
  requirements: SnapshotOut<Requirement>[];
  acceptanceCriteria: SnapshotOut<AcceptanceCriteria>[];
  testScenarios: SnapshotOut<TestScenario>[];
  testScenarioIndex: number;
}
export interface GenerateTestCasesResponseBody {
  testCases: SnapshotIn<TestCase>[];
}

export async function POST(request: Request) {
  const {
    description,
    productOverview,
    userStories,
    requirements,
    acceptanceCriteria,
    testScenarios,
    testScenarioIndex,
  } = (await request.json()) as GenerateTestCasesRequestBody;

  const result = await ai.createChatCompletion({
    model: "gpt-3.5-turbo",
    n: 1,
    temperature: 0,
    messages: [
      { role: "user", content: systemPrompt },
      {
        role: "user",
        content: `description: ${description}`,
      },
      {
        role: "user",
        content: `product overview: ${productOverview}`,
      },
      {
        role: "user",
        content: `user stories: ${userStories
          .map(({ content }) => `- ${content}`)
          .join("\n")}`,
      },
      {
        role: "user",
        content: `requirements: ${requirements
          .map(({ content }) => `- ${content}`)
          .join("\n")}`,
      },
      {
        role: "user",
        content: `acceptance criteria: ${acceptanceCriteria
          .map(({ content }) => `- ${content}`)
          .join("\n")}`,
      },
      {
        role: "user",
        content: `test scenarios: ${testScenarios
          .map(({ content }) => `- ${content}`)
          .join("\n")}`,
      },
      {
        role: "user",
        content:
          "Ensure that each test case is concise, focused on the specific scenario, and avoids redundancy. Do not include steps that are irrelevant or contradict the test scenario.",
      },
      {
        role: "user",
        content: `Remember to cover edge cases and various combinations of inputs while keeping the test steps clear and straightforward. Trying to cover edge cases and various combinations of inputs shouldn't cause you to generate inputs/edge cases that are not in compliance with the test scenario.`,
      },
      {
        role: "user",
        content: `Remember to not cover cases that belong to other test scenarios.`,
      },
      {
        role: "user",
        content: `Sample of good test cases:
  Test Case: Addition of two small positive integers
  Steps:
  Input the first small positive integer into the calculator.
  Click on the "+" button.
  Input the second small positive integer into the calculator.
  Click on the "=" button.
  Verify that the result displayed on the calculator is the sum of the two input integers.

  Test Case: Addition of two large positive integers
  Steps: [...]

  Test Case: Addition of a positive integer and a positive decimal number
  Steps: [...]

  Test Case: Addition of the largest possible positive integers
  Steps: [...]

  Test Case: Addition of a positive integer and the smallest possible positive decimal
  Steps: [...]

  These are good because they cover general use cases, edge cases and different combinations while not covering anything beyond the obligations of their test scenario.`,
      },
      {
        role: "user",
        content: `Sample of a bad test case:
  Test Case: Addition of two negative integers
  Test Steps:
  1. Input the first negative integer into the calculator.
  2. Click on the "+" button.
  3. Input the second negative integer into the calculator.
  4. Click on the "=" button.
  5. Verify that the result displayed on the calculator is the sum of the two input integers.
  6. Repeat the test with different sets of negative integers.
  7. Verify that the result is negative when adding two negative integers.
  8. Verify that the result is correct when adding two negative integers with different absolute values.
  9. Verify that the result is correct when adding a negative integer and a positive integer.
  10. Verify that the result is correct when adding a positive integer and a negative integer.

  The provided test case is a bad example because:

  1. It has redundant steps: Steps 6 and 7 are redundant because if step 6 is passed (which verifies the sum of different sets of negative integers), step 7 would already be satisfied (which checks if the result is negative when adding two negative integers).
  2. It contains unrelated steps: Steps 9 and 10 are unrelated to the test case description, which is focused on the addition of two negative integers. These steps test the addition of a negative integer and a positive integer, which should be part of a separate test case.
  In summary, a bad test case can contain redundant steps, unrelated steps, or lack focus on the specific scenario it is supposed to test. Good test cases should be concise, relevant, and focused on the intended test scenario.`,
      },
      {
        role: "user",
        content: `Another sample of a bad test case for test scenario "Division of a positive and a negative number":
  Test Case 1: Division of a positive and a negative number
  Inputs:
  - Positive integer and negative integer
  - Positive decimal and negative decimal
  - Positive integer and negative decimal
  - Positive decimal and negative integer
  - Zero and negative integer
  - Zero and positive integer
  - Negative decimal and zero
  - Positive decimal and zero

  Test Steps:
  1. Input the positive integer and negative integer into the calculator.
  2. Click on the "/" button.
  3. Verify that the result displayed on the calculator is the quotient of the two input integers.
  4. Repeat the test with the other input combinations.
  5. Verify that the result is negative when dividing a positive integer by a negative integer.
  6. Verify that the result is negative when dividing a positive decimal by a negative decimal.
  7. Verify that the result is negative when dividing a positive integer by a negative decimal.
  8. Verify that the result is negative when dividing a positive decimal by a negative integer.
  9. Verify that the result is zero when dividing zero by a negative integer.
  10. Verify that the result is undefined when dividing a positive integer by zero.
  11. Verify that the result is zero when dividing zero by a positive integer.
  12. Verify that the result is undefined when dividing a positive decimal by zero.
  13. Verify that the result is undefined when dividing a negative decimal by zero.
  14. Verify that the result is zero when dividing a negative decimal by a positive integer.
  15. Verify that the result is zero when dividing a negative integer by a positive decimal.

  It's bad because instead of writing multiple test cases to handle different combinations, it is providing all the inputs and verifications in the same run. How can step 6 be checked when step 1 explicitly states innputs are integer? The test runner can't travel in time when it reaches step 6 and change the inputs in step 1, it's running an instruction set and can't change what has been already done.

  It is also checking division by zero when it is not the obligation of this test scenario to check that.`,
      },
      {
        role: "user",
        content:
          "Ensure that the created test cases are not designed in such a manner that they can be integrated into other test scenarios.",
      },
      ...generatePrompt("test cases"),
      {
        role: "user",
        content: `Only focus on generating test cases specifically for this particular test scenario: ${testScenarios[testScenarioIndex].content}`,
      },
    ],
  });

  const testCases = result.data.choices[0].message?.content;

  if (testCases == null) {
    return NextResponse.json(
      {
        message: 'No response generated by ai for "test cases"!',
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    testCases: prepareContent(testCases),
  } as GenerateTestCasesResponseBody);
}
