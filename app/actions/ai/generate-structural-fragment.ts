"use server";
import "server-only";
import {
  AIModelError,
  generateStructuralFragmentPrompt,
  generateSystemPrompt,
  queryAiModel,
} from "actions/lib/prompts";
import { ActionParameters, ActionReturnValue } from "lib/types";
import {
  ENGINEER_ROLE_BY_STEP,
  STEP_BY_STRUCTURAL_FRAGMENT,
  StructuralFragment,
} from "store";

interface GenerateStructuralFragmentParameters extends ActionParameters {
  structuralFragment: StructuralFragment;
  parentId?: string;
}

export async function generateStructuralFragment({
  state,
  structuralFragment,
  parentId,
}: GenerateStructuralFragmentParameters): Promise<ActionReturnValue> {
  try {
    const result = await queryAiModel([
      generateSystemPrompt(
        ENGINEER_ROLE_BY_STEP[STEP_BY_STRUCTURAL_FRAGMENT[structuralFragment]],
      ),
      `current state: ${state}`,
      ...generateStructuralFragmentPrompt(structuralFragment),
      ...{
        [StructuralFragment.PrimaryFeature]: [],
        [StructuralFragment.TargetUser]: [],
        [StructuralFragment.Requirement]: [
          `Generate **formal software requirements** based on the product overview. Follow these strict rules:

## **Mandatory Requirements Structure**
Each requirement must follow this format:
- **Content:** A precise, unambiguous statement of what the software must do.
- **Priority:** (High, Medium, Low) based on user value and dependencies.
- **References:** Relevant structural fragments (if any). Rarely it can be anything other than primary features and target users.
- **Dependencies:** Other requirements that must be met first (if any).

## **Strict Requirements for Quality**
- **No Subjective Language:** Avoid vague terms like "efficient," "user-friendly," "intuitive," or "seamless."
- **Each Requirement Must Be Testable:** Every requirement must be written in a way that can be verified through tests.
- **Avoid Implementation Details:** Focus on **what** the system must do, not **how** to implement it.
- **Requirements Must Be Independent:** Minimize dependencies unless necessary.
-
## **Examples of Bad Requirements (DO NOT FOLLOW)**
❌ "The system should be fast and easy to use."  
❌ "The application should have a good design."  
❌ "The system should handle large amounts of data efficiently." **Prioritize Clarity and Precision:** Use explicit, measurable language.

## **Examples of Good Requirements**
✅ **REQ-001** - The system must allow users to reset their password via email verification. (Priority: High)  
✅ **REQ-002** - The system must generate a CSV report of sales data within 5 seconds for a dataset of up to 100,000 entries. (Priority: Medium)  

**Strictly adhere to these guidelines. If the provided input does not allow generating valid requirements, call the \`communicate\` function.**`,
        ],
        [StructuralFragment.UserStory]: [
          `Generate user stories based on requirements following these strict rules:

## **Mandatory User Story Format**
Each story must follow this format exactly:
- **Content:** As a [specific user role], I want [clear, testable goal], so that [objective benefit].
- **Priority:** (High, Medium, Low) based on user value and dependencies.
- **References:** Relevant structural fragments (if any). Rarely it can be anything other than requirements.
- **Dependencies:** Other stories that must be met first (if any).

## **Strict Requirements**
- **No Subjective Language:** Avoid vague terms like "user-friendly," "intuitive," or "without confusion." Instead, describe concrete functionalities or behaviors.
- **Testability is Required:** Every user story must describe a goal that can be verified with a test case.
- **Avoid Overly Broad Goals:** Each story must describe a small, independently implementable feature.

## **Examples of Bad User Stories (DO NOT FOLLOW)**
❌ As a general user, I want a user-friendly interface, so that I can easily navigate.  
❌ As a user, I want the app to be intuitive, so that I can use it smoothly

## **Examples of Good User Stories**
✅ As a registered user, I want to reset my password via email verification, so that I can regain access to my account securely.  
✅ As an administrator, I want to generate monthly sales reports in CSV format, so that I can analyze revenue trends.

**Strictly adhere to these guidelines. If the description does not allow generating valid user stories, call the \`communicate\` function.**`,
        ],
        [StructuralFragment.AcceptanceCriteria]: [
          `Generate **clear and testable acceptance criteria** based on the user stories. Follow these strict rules:

## **Mandatory Acceptance Criteria Structure**
Each acceptance criterion must follow this format:
- **Content:** A precise, measurable condition that determines if the user story is implemented correctly.
- **References:** Relevant structural fragments (if any). rarely it can be anything other than user stories.

## **Strict Rules for Valid Acceptance Criteria**
- **Must Be Binary (Pass/Fail):** The criterion must be clearly testable, with an unambiguous pass/fail outcome.
- **Avoid Subjective Language:** Terms like "easy to use," "intuitive," or "efficient" are not allowed.
- **Ensure Coverage:** Each user story must have at least one associated acceptance criterion.
- **No Implementation Details:** Acceptance criteria must focus on verifying the outcome, not how the system achieves it.

## **Examples of Bad Acceptance Criteria (DO NOT FOLLOW)**
❌ "The system should be easy to navigate."  
❌ "Users should find the password reset process simple."  

## **Examples of Good Acceptance Criteria**
✅ **AC-001** (REQ-001) - When a user requests a password reset, the system must send an email with a reset link within 30 seconds.  
✅ **AC-002** (REQ-002) - When a report is generated with up to 100,000 entries, the system must produce a CSV file within 5 seconds.  

**Strictly adhere to these guidelines. If the provided requirements do not allow generating valid acceptance criteria, call the \`communicate\` function.**`,
        ],
        [StructuralFragment.TestScenario]: [
          "Test execution will be performed by machines. In this stage you are asked to only generate the test scenario titles without the test cases. Generating test cases will be done later in a separate request.",
          `Generate **high-level test scenarios** based on the acceptance criteria. Each scenario must define a situation that needs to be tested but should NOT include detailed test steps or expected results (those will be handled in the test cases phase). Follow these strict rules:

## **Mandatory Test Scenario Structure**
Each test scenario must follow this format:
- **Content:** A brief, descriptive title of the scenario.
- **References:** List of acceptance criteria it verifies.
- **Dependencies:** Other requirements that must be met first (if any).

## **Strict Rules for Valid Test Scenarios**
- **Keep It High-Level:** Do not include step-by-step instructions or expected results.
- **Ensure Each Acceptance Criterion Has At Least One Test Scenario.**  
- **No Subjective or Vague Terms:** The scenario must be clear and objective.
- **Cover Both Expected and Edge Cases:** Ensure test scenarios consider normal, boundary, and failure conditions.

## **Examples of Bad Test Scenarios (DO NOT FOLLOW)**
❌ "Test if the system works correctly."  
❌ "Ensure the UI is intuitive."  

## **Examples of Good Test Scenarios**
✅ **TS-001** (AC-001) - Verify that the password reset email is sent when a user requests a password reset.  
✅ **TS-002** (AC-002) - Verify that the system generates a CSV report within the expected time for a dataset of 100,000 entries.  
✅ **TS-003** (AC-002) - Verify that the system handles CSV report generation failure when the dataset exceeds system capacity.  

**Strictly adhere to these guidelines. If the provided acceptance criteria do not allow generating valid test scenarios, call the \`communicate\` function.**`,
        ],
        [StructuralFragment.TestCase]: [
          `Generate **detailed and structured test cases** for the test scenario with ID **${parentId}**. Follow these strict rules:

## **Mandatory Test Case Structure**
Each test case must follow this format:
- **Content:** Containing:
  - **Title:** A concise, descriptive name for the test case.
  - **Steps:** A clear, sequential list of actions required to execute the test.
  - **Expected Result:** A precise statement of what should happen when the test is executed.
- **Parent:** The test scenario ID to which this case belongs.
- **References:** Relevant structural fragments (if any).

## **Strict Rules for Valid Test Cases**
- **Each Test Case Must Be Concise & Focused** – It should cover exactly **one** aspect of the test scenario.
- **No Redundancy:** Avoid repeating test cases that cover the same conditions.
- **Edge Cases & Input Variations:** Ensure test cases explore boundaries, but do **not** introduce scenarios that contradict the test scenario.
- **No Cross-Scenario Coverage:** Do **not** include cases that belong to other test scenarios.
- **Maintain Logical Input Variations:** While testing different input combinations, do **not** introduce unrealistic or irrelevant inputs.

## **Examples of Bad Test Cases (DO NOT FOLLOW)**
❌ **Addition of two numbers**  
   Steps: 1. Open calculator. 2. Add numbers. 3. Verify the result.  
   🚨 *Issue:* Too vague, lacks specific input values and expected results.  

❌ **Test all arithmetic operations at once**  
   Steps: 1. Add two numbers. 2. Subtract numbers. 3. Multiply numbers. 4. Divide numbers.  
   🚨 *Issue:* Covers multiple scenarios instead of focusing on one.

## **Examples of Good Test Cases**
✅ **Addition of two small positive integers**  
   **Steps:**  
   1. Input the first small positive integer into the calculator.  
   2. Click on the "+" button.  
   3. Input the second small positive integer into the calculator.  
   4. Click on the "=" button.  
   5. Verify that the result displayed on the calculator is the sum of the two input integers.  

✅ **Addition of two large positive integers**  
✅ **Addition of a positive integer and a positive decimal number**  
✅ **Addition of the largest possible positive integers**  
✅ **Addition of a positive integer and the smallest possible positive decimal**  

**Strictly adhere to these guidelines. If the provided test scenario does not allow generating valid test cases, call the \`communicate\` function.**`,
        ],
        [StructuralFragment.TestCode]: [],
      }[structuralFragment],
    ]);

    return {
      functionCall: result,
    };
  } catch (error) {
    if (error instanceof AIModelError) {
      throw error;
    }
    console.error(error);
    throw new Error("Unexpected error while handling comment");
  }
}
