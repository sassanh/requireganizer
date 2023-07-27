import { ChatCompletionFunctions, Configuration, OpenAIApi } from "openai";

import { Framework, ProgrammingLanguage, StructuralFragment } from "@/store";

export interface FunctionCall {
  name: ManipulationFunctionName;
  arguments?: string;
}

export interface RequestBody {
  state: string;
}

export interface ResponseBody {
  functionCall: FunctionCall;
}

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

export const ai = new OpenAIApi(configuration);

export const generatePrompt = (subject: StructuralFragment): string[] => [
  `Please generate or modify existing ${subject} based on materials generated in prior steps.`,
  `Do not include any other titles or headings like 'Test Scenarios:' or 'Requirements:', and just provide the ${subject}.`,
];

export const systemPrompt = `You are the AI engine inside Requireganizer. Requireganizer is an application that starts by asking its user a description of a piece of software they are willing to develop. It then generates product overview based on this description and chooses the framework and the programming language for it.
Requireganizer then runs minor iterations with the help of you to complete a major iteration of the software development. A major iteration is supposed to consist these minor iterations:
1. Generate or modify existing user stories based on the product overview and materials generated in prior steps.
2. Generate or modify existing requirements based on the user stories and materials generated in prior steps.
3. Generate or modify existing acceptance criteria based on the requirements and materials generated in prior steps.
4. Generate or modify existing test scenarios based on the acceptance criteria and materials generated in prior steps.
5. Generate or modify existing test cases based on the test scenarios and materials generated in prior steps.
6. Generate or modify existing test code based on test scenarios and materials generated in prior steps.
7. Generate or modify existing code to satisfy tests and materials generated in prior steps.
8. Run retrospective to understand the concerns of the user in the process.
9. Help the user to update the specification and run the major iteration again.

Requireganizer holds its state in this data structure:
{
  programmingLanguage: "PROGRAMMING_LANGUAGE_NAME",
  framework: "FRAMEWORK_NAME",
  description: "DESCRIPTION_STRING",
  productOverview: "PRODUCT_OVERVIEW_STRING",
  userStories: {id: "ITEM_UUID", content: "TEXT_CONTENT"}[],
  requirements: {id: "ITEM_UUID", content: "TEXT_CONTENT"}[],
  acceptanceCriteria: {id: "ITEM_UUID", content: "TEXT_CONTENT"}[],
  testScenarios: {id: "ITEM_UUID", content: "TEXT_CONTENT", testCases: {id: "ITEM_UUID", content: "TEXT_CONTENT"}[]}[],
}

At each prompt you are provided with the description of your current task + a partial version of the current state of Requireganizer.

You should only use the functions you have been provided with to fulfill your task.
You can always call the error function if something is not right and you can't fulfill your task correctly.`;

export enum EntityType {
  UserStory = "user_story",
  Requirement = "requirement",
  AcceptanceCriteria = "acceptance_criteria",
  TestScenario = "test_scenario",
  TestCase = "test_case",
}

export const manipulationFunctions = [
  {
    name: "initialize",
    description:
      "Sets the product overview, framework and programming language",
    parameters: {
      type: "object",
      properties: {
        productOverview: {
          type: "string",
          description: "The generated product overview",
        },
        framework: {
          type: "string",
          enum: Object.values(Framework),
          description: "The chosen framework",
        },
        programmingLanguage: {
          type: "string",
          enum: Object.values(ProgrammingLanguage),
          description: "The chosen programming language",
        },
      },
    },
  },
  {
    name: "updateList",
    description:
      `Update items in a list of entities, for example list of user stories, requirements, acceptance criteria, etc by manipulating the list with "modification", "sort", insertion" and "removal" operations. Sort and modifications are applied first on existing items, and then insertions and removals are applied.
if an old entity has the same purpose as a new entity but its content should be different, it is preferred to modify it instead of removing it and adding it again. For example if an old entity is "we need 2 buttons" and it should be changed to "we need 3 buttons", modification is preferred over removal and re-insertion so that the uuid of the item is preserved. But if the new item has a different purpose, even if its string distance with the old content is small, remove and insert is preferred to assign a new uuid.`,
    parameters: {
      type: "object",
      properties: {
        entityType: {
          type: "string",
          enum: Object.values(EntityType),
          description: "The entity type of the list to be updated.",
        },
        parentId: {
          type: "string",
          description:
            "(optional) The id of the parent element, for example a test case belongs to a test scenario.",
        },
        modifications: {
          type: "array",
          description: "List of items to be modified. Can be empty in case no modification is required.",
          items: {
            type: "object",
            properties: {
              content: {
                type: "string",
                description: "The new text content of the entity",
              },
              id: {
                type: "number",
                description:
                  "The uuid of the entity to be modified. not to be confused with the index of the entity.",
              },
            },
          },
        },
        sort: {
          type: "array",
          description:
            "List of existing uuids in the desired order. If no change in the order is intended, this can be left empty.",
          items: {
            type: "string",
            description: "uuid of an entity",
          },
        },
        insertions: {
          type: "array",
          description: "List of items to be added. Can be empty in case no insertion is required.",
          items: {
            type: "object",
            properties: {
              content: {
                type: "string",
                description: "The text content of the entity",
              },
              index: {
                type: "number",
                description: "Index, in which the item will be placed",
              },
            },
          },
        },
        removals: {
          type: "array",
          description: "List of existing uuids needed to be removed from the list. Can be empty in case no removal is required",
          items: {
            type: "string",
            description: "uuid of the entity to be removed",
          },
        },
      },
      required: [
        "entityType",
        "modifications",
        "sort",
        "insertions",
        "removals",
      ],
    },
  },
  {
    name: "error",
    description:
      "Used when the task cannot be fulfilled properly due to an error/inconsistency/etc in the provided prompt or Requireganizer state",
    parameters: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "The description of the error",
        },
      },
    },
  },
] as const;

export const manipulationFunctionNames = manipulationFunctions.map(
  ({ name }) => name
);

export type ManipulationFunctionName =
  (typeof manipulationFunctionNames)[number];

export class AIModelError extends Error { }

export const queryAiModel = async (
  query: string[],
  functions: readonly ChatCompletionFunctions[] = manipulationFunctions
): Promise<FunctionCall> => {
  try {
    console.log("Request:", query);
    const result = await ai.createChatCompletion({
      model: "gpt-4-0613",
      n: 1,
      temperature: 0,
      messages: query.map((item) => ({ content: item, role: "user" })),
      functions: functions as ChatCompletionFunctions[],
    });
    console.log("Response:", result.data.choices[0]);

    const functionCall = result.data.choices[0].message?.function_call;

    if (functionCall == null) {
      throw new Error("No response generated by AI model");
    }

    const { name, arguments: arguments_ } = functionCall;

    if (name !== "error" && name !== "initialize" && name !== "updateList") {
      throw new Error("Invalid response generated by AI model!");
    }

    return { name, arguments: arguments_ };
  } catch (e) {
    console.error("Error while querying AI model:", e);
    throw new Error(
      "Something bad happened while trying to query the AI model."
    );
  }
};
