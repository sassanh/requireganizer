import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMMUNICATE_TOOL,
  buildArtifactListTool,
  buildFragmentRevisionTool,
  buildProductOverviewTool,
} from "../app/ai-harness/tools";
import {
  formatQualityContract,
  getArtifactStageDefinition,
  qualityContractForFragment,
  qualityContractForStage,
} from "../app/ai-harness/workflow";
import { StructuralFragment, WorkflowStage } from "../app/store/constants";

function record(value: unknown): Record<string, unknown> {
  assert.ok(value != null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

/** The item variants of a list tool that are objects: a new item, then, once items exist, a change to one. */
function artifactItemSchemas(tool: ReturnType<typeof buildArtifactListTool>) {
  const parameters = record(tool.parameters);
  const properties = record(parameters.properties);
  const items = record(properties.items);
  const oneOf = record(items.items).oneOf as unknown[];
  return oneOf
    .filter((candidate) => record(candidate).type === "object")
    .map(record);
}

describe("AI function-tool schemas", () => {
  it("provides a separate communicate tool", () => {
    assert.equal(COMMUNICATE_TOOL.name, "communicate");
    assert.deepEqual(record(COMMUNICATE_TOOL.parameters).required, ["message"]);
  });

  it("names existing items by code and embeds no project ids", () => {
    const tool = buildArtifactListTool({
      definition: getArtifactStageDefinition(StructuralFragment.AcceptanceCriteria),
    });

    assert.equal(tool.name, "submit_acceptance_criteria_list");
    const [newItem, change] = artifactItemSchemas(tool);
    assert.ok((newItem!.required as unknown[]).includes("key"));
    assert.equal("item" in record(newItem!.properties), false);
    // A change names its item and keeps every field it leaves out.
    assert.deepEqual(change!.required, ["item"]);
    const properties = record(change!.properties);
    assert.equal(record(properties.item).enum, undefined);

    const references = record(properties.references);
    assert.deepEqual(references.items, { type: "string", minLength: 1 });
    assert.match(String(references.description), /\(US, REQ\)/);
    // The only enum left is the priority, so the schema never goes stale as items change.
    assert.equal(JSON.stringify(tool.parameters).match(/"enum"/g)?.length, 2);
  });

  it("puts the stage quality contract on submit tools", () => {
    const overview = buildProductOverviewTool();
    const overviewContract = qualityContractForStage(WorkflowStage.ProductOverview);
    assert.ok(overviewContract != null);
    assert.ok(overview.description?.includes(formatQualityContract(overviewContract)));

    const definition = getArtifactStageDefinition(StructuralFragment.UserStory);
    const stories = buildArtifactListTool({ definition });
    const storyContract = qualityContractForStage(WorkflowStage.UserStories);
    assert.ok(storyContract != null);
    assert.ok(stories.description?.includes(formatQualityContract(storyContract)));

    const revision = buildFragmentRevisionTool(StructuralFragment.UserStory);
    const fragmentContract = qualityContractForFragment(StructuralFragment.UserStory);
    assert.ok(fragmentContract != null);
    assert.ok(revision.description?.includes(formatQualityContract(fragmentContract)));
    assert.match(revision.description ?? "", /remove: true/);
    const revisionParameters = record(revision.parameters);
    const revisionProperties = record(revisionParameters.properties);
    const patch = record(revisionProperties.patch);
    const patchProperties = record(patch.properties);
    assert.equal(record(patchProperties.remove).type, "boolean");
  });
});
