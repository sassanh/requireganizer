import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMMUNICATE_TOOL,
  buildArtifactListTool,
} from "../app/ai-harness/tools";
import { getArtifactStageDefinition } from "../app/ai-harness/workflow";
import { StructuralFragment } from "../app/store/constants";

function record(value: unknown): Record<string, unknown> {
  assert.ok(value != null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function artifactItemSchema(tool: ReturnType<typeof buildArtifactListTool>) {
  const parameters = record(tool.parameters);
  const properties = record(parameters.properties);
  const items = record(properties.items);
  return record(items.items);
}

describe("AI function-tool schemas", () => {
  it("provides a separate communicate tool", () => {
    assert.equal(COMMUNICATE_TOOL.name, "communicate");
    assert.deepEqual(record(COMMUNICATE_TOOL.parameters).required, ["message"]);
  });

  it("requires proposal-local keys and constrains preserved IDs", () => {
    const definition = getArtifactStageDefinition(
      StructuralFragment.AcceptanceCriteria,
    );
    const tool = buildArtifactListTool({
      definition,
      state: {
        requirements: [
          { id: "requirement-1", type: StructuralFragment.Requirement },
        ],
        userStories: [
          { id: "story-1", type: StructuralFragment.UserStory },
        ],
        acceptanceCriteria: [
          { id: "criterion-1", type: StructuralFragment.AcceptanceCriteria },
        ],
      },
    });

    assert.equal(tool.name, "submit_acceptance_criteria_list");
    const item = artifactItemSchema(tool);
    const properties = record(item.properties);
    assert.ok((item.required as unknown[]).includes("key"));
    assert.deepEqual(record(properties.id).enum, ["criterion-1"]);

    const references = record(properties.references);
    const reference = record(references.items);
    const referenceProperties = record(reference.properties);
    assert.deepEqual(record(referenceProperties.id).enum, [
      "story-1",
      "requirement-1",
    ]);
  });

  it("does not expose a persisted id field when the target list is empty", () => {
    const tool = buildArtifactListTool({
      definition: getArtifactStageDefinition(StructuralFragment.UserStory),
      state: {
        productOverview: {
          primaryFeatures: [
            { id: "feature-1", type: StructuralFragment.PrimaryFeature },
          ],
          targetUsers: [
            { id: "user-1", type: StructuralFragment.TargetUser },
          ],
        },
        userStories: [],
      },
    });

    const properties = record(artifactItemSchema(tool).properties);
    assert.equal("id" in properties, false);
    assert.ok("key" in properties);
  });

  it("serializes stable schema fields before request-specific ID enums", () => {
    const tool = buildArtifactListTool({
      definition: getArtifactStageDefinition(
        StructuralFragment.AcceptanceCriteria,
      ),
      state: {
        requirements: [
          { id: "requirement-dynamic", type: StructuralFragment.Requirement },
        ],
        userStories: [
          { id: "story-dynamic", type: StructuralFragment.UserStory },
        ],
        acceptanceCriteria: [
          {
            id: "criterion-dynamic",
            type: StructuralFragment.AcceptanceCriteria,
          },
        ],
      },
    });
    const serialized = JSON.stringify(tool.parameters);

    assert.ok(
      serialized.indexOf('"required"') < serialized.indexOf('"properties"'),
    );
    assert.ok(
      serialized.indexOf('"dependencies"') <
        serialized.indexOf("story-dynamic"),
    );
    assert.ok(
      serialized.indexOf("story-dynamic") <
        serialized.indexOf("criterion-dynamic"),
    );
  });
});
