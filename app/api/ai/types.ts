import { Framework, ProgrammingLanguage } from "store";

export enum EntityType {
  UserStory = "user_story",
  Requirement = "requirement",
  AcceptanceCriteria = "acceptance_criteria",
  TestScenario = "test_scenario",
  TestCase = "test_case",
}

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

export const manipulationFunctions = [
  {
    type: "function",
    function: {
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
  },
  {
    type: "function",
    function: {
      name: "updateList",
      description: `Update items in a list of entities, for example list of user stories, requirements, acceptance criteria, etc by manipulating the list with "modification", "sort", insertion" and "removal" operations. Sort and modifications are applied first on existing items, and then insertions and removals are applied.
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
            description:
              "List of items to be modified. Can be empty in case no modification is required.",
            items: {
              type: "object",
              properties: {
                content: {
                  type: "string",
                  description: "The new text content of the entity",
                },
                id: {
                  type: "string",
                  description:
                    "The uuid of the entity to be modified. not to be confused with the index of the entity.",
                },
              },
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
  },
] as const;

export const manipulationFunctionNames = manipulationFunctions.map(
  ({ function: { name } }) => name,
);

export type ManipulationFunctionName =
  (typeof manipulationFunctionNames)[number];
