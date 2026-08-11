import type { FunctionDefinition } from "openai/resources/shared";

import {
  collectArtifactIdentities,
  getExistingTargetIds,
} from "ai-harness/validation";
import type { ArtifactStageDefinition } from "ai-harness/workflow";
import {
  Framework,
  Priority,
  ProgrammingLanguage,
  StructuralFragment,
} from "store/constants";

export type HarnessToolDefinition = FunctionDefinition;

const objectSchema = (
  properties: Record<string, unknown>,
  required: readonly string[],
): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const nonEmptyString = (description: string): Record<string, unknown> => ({
  type: "string",
  minLength: 1,
  description,
});

const stringArray = (
  description: string,
  options: { minItems?: number; values?: readonly string[] } = {},
): Record<string, unknown> => ({
  type: "array",
  description,
  ...(options.minItems === undefined ? {} : { minItems: options.minItems }),
  items: {
    type: "string",
    minLength: 1,
    ...(options.values === undefined || options.values.length === 0
      ? {}
      : { enum: options.values }),
  },
});

export const COMMUNICATE_TOOL: HarnessToolDefinition = {
  name: "communicate",
  description:
    "Ask the user one concise, actionable question when essential information is missing, contradictory, or unsafe to infer.",
  parameters: objectSchema(
    {
      message: nonEmptyString(
        "A concise explanation of what is missing and what the user must clarify.",
      ),
    },
    ["message"],
  ),
};

export function buildProductOverviewTool(): HarnessToolDefinition {
  return {
    name: "submit_product_overview",
    description: "Submit the complete product-overview proposal.",
    parameters: objectSchema(
      {
        name: nonEmptyString("The product name."),
        purpose: nonEmptyString("A concise, outcome-oriented purpose."),
        primaryFeatures: stringArray("Atomic primary feature descriptions.", {
          minItems: 1,
        }),
        targetUsers: stringArray("Specific target user groups.", {
          minItems: 1,
        }),
        framework: {
          type: "string",
          enum: Object.values(Framework),
          description: "A supported framework.",
        },
        programmingLanguage: {
          type: "string",
          enum: Object.values(ProgrammingLanguage),
          description:
            "A language supported by the selected framework. The valid framework-language pairs are supplied in the task context.",
        },
      },
      [
        "name",
        "purpose",
        "primaryFeatures",
        "targetUsers",
        "framework",
        "programmingLanguage",
      ],
    ),
  };
}

function referenceSchema(
  definition: ArtifactStageDefinition,
  state: Record<string, unknown>,
): Record<string, unknown> {
  const allowedTypes = definition.allowedReferenceTypes;
  const allowedIds = [...collectArtifactIdentities(state).values()]
    .filter(({ type }) => allowedTypes.includes(type))
    .map(({ id }) => id);

  return objectSchema(
    {
      id: {
        ...nonEmptyString("An exact existing artifact ID from projectContext."),
        ...(allowedIds.length === 0 ? {} : { enum: allowedIds }),
      },
      type: {
        type: "string",
        enum: allowedTypes,
        description: "The exact type of the referenced artifact.",
      },
    },
    ["id", "type"],
  );
}

export function buildArtifactListTool({
  definition,
  state,
  parentId,
}: {
  definition: ArtifactStageDefinition;
  state: Record<string, unknown>;
  parentId?: string;
}): HarnessToolDefinition {
  const existingIds = [...getExistingTargetIds(
    state,
    definition.entityType,
    parentId,
  )];
  const itemProperties: Record<string, unknown> = {
    key: {
      type: "string",
      minLength: 1,
      maxLength: 80,
      pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$",
      description:
        "A proposal-local key unique within this result. Dependencies refer to these keys; this is not a persisted artifact ID.",
    },
    ...(existingIds.length === 0
      ? {}
      : {
        id: {
          type: "string",
          enum: existingIds,
          description:
            "Include only when preserving the intent of this exact existing target artifact. Omit for new artifacts.",
        },
      }),
    ...(definition.entityType === StructuralFragment.TestCase
      ? {
        title: nonEmptyString("A concise single-line test-case title."),
        steps: nonEmptyString("Numbered or sequential reproducible steps."),
        expectedResult: nonEmptyString("One precise observable result."),
      }
      : {
        content: nonEmptyString("The complete artifact text."),
      }),
    priority: {
      type: "string",
      enum: Object.values(Priority),
      description: "The artifact priority.",
    },
    references: {
      type: "array",
      minItems: 1,
      description: "Traceability references to exact upstream artifacts.",
      items: referenceSchema(definition, state),
    },
    dependencies: stringArray(
      "Proposal-local keys of items in this same result that must precede this item. Use an empty array when there are none.",
    ),
  };
  const itemRequired = [
    "key",
    ...(definition.entityType === StructuralFragment.TestCase
      ? ["title", "steps", "expectedResult"]
      : ["content"]),
    "priority",
    "references",
    "dependencies",
  ];

  return {
    name: `submit_${definition.entityType}_list`,
    description: `Submit the complete desired ${definition.entityType} list for the requested target only.`,
    parameters: objectSchema(
      {
        items: {
          type: "array",
          minItems: 1,
          description: "The complete desired target list, in display order.",
          items: objectSchema(itemProperties, itemRequired),
        },
      },
      ["items"],
    ),
  };
}

export function buildFragmentRevisionTool(
  entityType: StructuralFragment,
): HarnessToolDefinition {
  const patchProperties =
    entityType === StructuralFragment.TestCase
      ? {
        title: nonEmptyString("Optional replacement title."),
        steps: nonEmptyString("Optional replacement steps."),
        expectedResult: nonEmptyString("Optional replacement expected result."),
        priority: { type: "string", enum: Object.values(Priority) },
      }
      : {
        content: nonEmptyString("Optional replacement content."),
        priority: { type: "string", enum: Object.values(Priority) },
      };

  return {
    name: "submit_fragment_revision",
    description: "Submit a patch for exactly the requested artifact.",
    parameters: objectSchema(
      {
        patch: {
          ...objectSchema(patchProperties, []),
          minProperties: 1,
        },
      },
      ["patch"],
    ),
  };
}

export function buildProjectConfigurationTool(): HarnessToolDefinition {
  return {
    name: "submit_project_configuration",
    description: "Submit the deterministic build and test configuration.",
    parameters: objectSchema(
      {
        packageManager: nonEmptyString("The package or dependency manager."),
        testFramework: nonEmptyString("The test framework."),
        buildCommand: nonEmptyString("The exact non-interactive build command."),
        testCommand: nonEmptyString("The exact non-interactive test command."),
        settings: {
          type: "object",
          description: "Framework-specific JSON-compatible settings.",
          additionalProperties: true,
        },
      },
      [
        "packageManager",
        "testFramework",
        "buildCommand",
        "testCommand",
        "settings",
      ],
    ),
  };
}

export function buildScaffoldTool(): HarnessToolDefinition {
  return {
    name: "submit_project_scaffold",
    description: "Submit the complete minimal virtual project scaffold.",
    parameters: objectSchema(
      {
        files: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: objectSchema(
            {
              path: nonEmptyString("A safe relative POSIX path."),
              content: {
                type: "string",
                description: "The complete text file content.",
              },
            },
            ["path", "content"],
          ),
        },
      },
      ["files"],
    ),
  };
}

export function buildTestCodeTool(): HarnessToolDefinition {
  return {
    name: "submit_test_code",
    description:
      "Submit the complete scenario test-file content for the server-controlled target path.",
    parameters: objectSchema(
      {
        code: nonEmptyString("The complete executable scenario test file."),
      },
      ["code"],
    ),
  };
}
