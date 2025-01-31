import OpenAI from "openai";

import { FunctionCall, ManipulationFunction } from "lib/types";
import {
  ENGINEER_ROLE_LABELS,
  EngineerRole,
  Framework,
  Priority,
  ProgrammingLanguage,
  StructuralFragment,
} from "store";
import { isEnumMember } from "utilities";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const generateStructuralFragmentPrompt = (
  subject: StructuralFragment,
): string[] => [
  `Please generate or modify existing ${subject} based on materials generated in prior steps.`,
];

export const generateSystemPrompt = (roles: EngineerRole[]) => `
You are the AI engine inside Requireganizer, acting as ${roles
  .map((role) => `a ${ENGINEER_ROLE_LABELS[role]}`)
  .join(" and a ")}.

Requireganizer is a software factory that begins by gathering a user-provided software description. It then generates a product overview, selects the appropriate framework and programming language, and iterates through the development cycle in structured steps:

Start of iteration  
1. User stories  
2. Requirements  
3. Acceptance criteria  
4. Test scenarios  
5. Test cases  
6. Test code  
7. Software code  
8. Retrospective  
9. Specification update  
End of iteration  

### State Structure:
Requireganizer maintains the following state and communicates it in each prompt with you:
\`\`\`json
{
  "description": "DESCRIPTION_STRING",
  "productOverview": {
    "name": "SOFTWARE_NAME",
    "purpose": "SOFTWARE_PURPOSE",
    "primaryFeatures": {"id": "ITEM_UUID", "content": "TEXT_CONTENT"}[],
    "targetUsers": {"id": "ITEM_UUID", "content": "TEXT_CONTENT"}[],
    "programmingLanguage": "PROGRAMMING_LANGUAGE_NAME",
    "framework": "FRAMEWORK_NAME",
  },
  "userStories": {"id": "ITEM_UUID", "content": "TEXT_CONTENT"}[],
  "requirements": {"id": "ITEM_UUID", "content": "TEXT_CONTENT"}[],
  "acceptanceCriteria": {"id": "ITEM_UUID", "content": "TEXT_CONTENT"}[],
  "testScenarios": {"id": "ITEM_UUID", "content": "TEXT_CONTENT", "testCases": {"id": "ITEM_UUID", "content": "TEXT_CONTENT"}[]}[]
}
\`\`\`

### Execution:
For each task, you receive:
- A task description  
- The relevant subset of the current Requireganizer state  

### Rules:
- Before starting any task, **critically assess** the provided prompt. If it lacks clarity, is incomplete, or can be improved, call the \`communicate\` function to address the issue with the user.
- Use **only** the provided functions to execute tasks—do not assume or invent missing details.  
- If a task cannot be completed due to missing, conflicting, or incorrect information, immediately call the \`communicate\` function to report the issue.`;

const structuralFragmentObject = {
  type: "object",
  properties: {
    content: {
      type: "string",
      description: "The text content of the entity",
    },
    priority: {
      type: "string",
      enum: Object.values(Priority),
      description: "Priority of the entity",
    },
    references: {
      type: "array",
      description:
        "List of references to other entities. Can be empty in case no reference is required.",
      items: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "uuid of the referenced entity",
          },
          type: {
            type: "string",
            enum: Object.values(StructuralFragment),
            description: "The type of the referenced entity",
          },
        },
        required: ["id", "type"],
      },
    },
    dependencies: {
      type: "array",
      description:
        "List of uuids of entities that this entity depends on. Can be empty in case no dependency is required.",
      items: {
        type: "string",
        description: "uuid of the dependent entity",
      },
    },
  },
  required: ["content", "priority", "references", "dependencies"],
};

export const manipulationFunctions = [
  {
    type: "function",
    function: {
      name: "initialize",
      description:
        "Sets the product overview, including name, purpose, primary features, target users, programming language, and framework",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The software’s name",
          },
          purpose: {
            type: "string",
            description:
              "A clear and concise statement of what the software does",
          },
          primaryFeatures: {
            type: "array",
            items: {
              type: "string",
            },
            description:
              "A list of key functionalities derived directly from the description, one line per feature",
          },
          targetUsers: {
            type: "array",
            items: {
              type: "string",
            },
            description:
              "Who will use this software. If not mentioned, pass an empty array",
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
        required: [
          "name",
          "purpose",
          "primaryFeatures",
          "targetUsers",
          "framework",
          "programmingLanguage",
        ],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "updateList",
      description: `Update items in a list of entities, for example list of user stories, requirements, acceptance criteria, etc by manipulating the list with "modification", "sort", insertion" and "removal" operations. Sort and modifications are applied first on existing items, and then insertions and removals are applied.
if an old entity has the same purpose as a new entity but its content should be different, it is preferred to modify it instead of removing it and adding it again. For example if an old entity is "we need 2 buttons" and it should be changed to "we need 3 buttons", modification is preferred over removal and re-insertion so that the uuid of the item is preserved. But if the new item has a different purpose, even if its string distance with the old content is small, remove and insert is preferred to assign a new uuid to break references intentionally.`,
      parameters: {
        type: "object",
        properties: {
          entityType: {
            type: "string",
            enum: Object.values(StructuralFragment),
            description: "The entity type of the list to be updated.",
          },
          parentId: {
            type: "string",
            description:
              "(optional) The uuid of the parent element, for example a test case belongs to a test scenario.",
          },
          modifications: {
            type: "array",
            description:
              "List of items to be modified. Can be empty in case no modification is required.",
            items: {
              type: "object",
              properties: {
                ...structuralFragmentObject.properties,
                id: {
                  type: "string",
                  description:
                    "The uuid of the entity to be modified. not to be confused with the index of the entity.",
                },
              },
              required: [...structuralFragmentObject.required, "id"],
            },
          },
          sort: {
            type: "array",
            description:
              "List of existing uuids in the desired order. If no change in the order is intended, an empty list can be provided.",
            items: {
              type: "string",
              description: "uuid of an entity",
            },
          },
          insertions: {
            type: "array",
            description:
              "List of items to be added. Can be empty in case no insertion is required.",
            items: {
              type: "object",
              properties: {
                ...structuralFragmentObject.properties,
                index: {
                  type: "number",
                  description: "Index, in which the item will be placed",
                },
              },
              required: [...structuralFragmentObject.required, "index"],
            },
          },
          removals: {
            type: "array",
            description:
              "List of existing uuids needed to be removed from the list. Can be empty in case no removal is required",
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
  },
  {
    type: "function",
    function: {
      name: "communicate",
      description:
        "Used when something should be communicated with the user or the task cannot be fulfilled properly due to an error/inconsistency/missing-information/etc",
      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description:
              "A description of the issue that needs to be communicated",
          },
          context: {
            type: "string",
            description:
              "The context in which the issue occurred, for example the entity type or the task that was being performed",
          },
        },
        required: ["description", "context"],
      },
    },
  },
] as const;

export const manipulationFunctionNames = manipulationFunctions.map(
  ({ function: { name } }) => name,
);

export class AIModelError extends Error {}

export const queryAiModel = async (
  query: string[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    ...manipulationFunctions,
  ],
): Promise<FunctionCall> => {
  try {
    console.warn("Request:", query);
    const result = await client.chat.completions.create({
      model: "gpt-4o",
      n: 1,
      messages: query.map((item) => ({ content: item, role: "user" })),
      tools,
    });
    console.warn(
      "Response:",
      JSON.stringify(result.choices[0].message, null, 2),
    );

    const functionCall = result.choices[0].message.tool_calls?.[0].function;

    if (functionCall == null) {
      throw new Error("No response generated by AI model");
    }

    const { name, arguments: arguments_ } = functionCall;

    if (!isEnumMember(name, ManipulationFunction)) {
      throw new Error("Invalid response generated by AI model!");
    }

    return { name, arguments: arguments_ };
  } catch (e) {
    console.error("Error while querying AI model:");
    console.error(e);
    if (e instanceof Error) {
      console.error(e.stack);
    }
    throw new Error(
      "Something bad happened while trying to query the AI model.",
    );
  }
};
