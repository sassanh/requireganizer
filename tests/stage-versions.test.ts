import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { unprotect } from "mobx-state-tree";

import { buildReadTools } from "../app/ai-agent/read-tools";
import {
  OVERVIEW_NAME_QUALITY_ID,
  OVERVIEW_PURPOSE_QUALITY_ID,
  StructuralFragment,
  WorkflowStage,
} from "../app/store/constants";
import { Store } from "../app/store/store";
import type { FlatStore } from "../app/store/store";

function storeWithRecordedStories(): FlatStore {
  const store = Store.create({
    productOverview: {
      name: "Plant Pal",
      purpose: "Help people keep houseplants alive.",
      primaryFeatures: [{ id: "feat-1", content: "Track watering" }],
      targetUsers: [{ id: "user-1", content: "Busy plant owners" }],
    },
  }) as unknown as FlatStore;
  store.approve(OVERVIEW_NAME_QUALITY_ID);
  store.approve(OVERVIEW_PURPOSE_QUALITY_ID);
  store.approve("feat-1");
  store.approve("user-1");
  store.setUserStories({
    userStories: [
      {
        id: "story-1",
        content:
          "As a busy plant owner, I want watering reminders, so that plants stay alive.",
        references: [
          { id: "feat-1", type: StructuralFragment.PrimaryFeature },
          { id: "user-1", type: StructuralFragment.TargetUser },
        ],
      },
    ],
  });
  store.approve("story-1");
  store.markStageGenerated(WorkflowStage.UserStories);
  store.setName({ name: "Plant Pal Pro" });
  store.approve(OVERVIEW_NAME_QUALITY_ID);
  return store;
}

function toolResultText(result: unknown): string {
  const content = (result as { content: { text: string }[] }).content;
  return content.map((block) => block.text).join("");
}

describe("stage version reads", () => {
  it("lists each stage's recorded input hash in the workflow state", async () => {
    const store = storeWithRecordedStories();
    const stateTool = buildReadTools(store).find(
      (tool) => tool.name === "get_workflow_state",
    );
    assert.ok(stateTool != null);
    const stages = (
      JSON.parse(toolResultText(await stateTool.execute("call-1", {}))) as {
        stages: { stage: string; inputHash: string | null }[];
      }
    ).stages;
    const stories = stages.find((entry) => entry.stage === "User Stories");
    assert.equal(stories?.inputHash, store.stageInputFingerprints.get(WorkflowStage.UserStories));
    const overview = stages.find((entry) => entry.stage === "Product Overview");
    assert.equal(overview?.inputHash, null);
  });

  it("returns the recorded version for a valid hash and the current without one", async () => {
    const store = storeWithRecordedStories();
    const artifactsTool = buildReadTools(store).find(
      (tool) => tool.name === "get_stage_artifacts",
    );
    assert.ok(artifactsTool != null);
    const hash = store.stageInputFingerprints.get(WorkflowStage.UserStories);
    assert.ok(hash != null);

    const recorded = JSON.parse(
      toolResultText(
        await artifactsTool.execute("call-1", { stage: WorkflowStage.ProductOverview, hash }),
      ),
    ) as { productOverview: { name: string } };
    assert.equal(recorded.productOverview.name, "Plant Pal");

    const current = JSON.parse(
      toolResultText(
        await artifactsTool.execute("call-2", { stage: WorkflowStage.ProductOverview }),
      ),
    ) as { productOverview: { name: string } };
    assert.equal(current.productOverview.name, "Plant Pal Pro");
  });

  it("rejects unknown hashes", async () => {
    const store = storeWithRecordedStories();
    const artifactsTool = buildReadTools(store).find(
      (tool) => tool.name === "get_stage_artifacts",
    );
    assert.ok(artifactsTool != null);
    await assert.rejects(
      () =>
        artifactsTool.execute("call-1", {
          stage: WorkflowStage.ProductOverview,
          hash: "deadbeefdeadbeefdead",
        }),
      /Unknown input version/,
    );
  });

  it("returns a stage's recorded inputs when paired with its own hash", async () => {
    const store = storeWithRecordedStories();
    const artifactsTool = buildReadTools(store).find(
      (tool) => tool.name === "get_stage_artifacts",
    );
    assert.ok(artifactsTool != null);
    const hash = store.stageInputFingerprints.get(WorkflowStage.UserStories);
    assert.ok(hash != null);

    const recorded = JSON.parse(
      toolResultText(
        await artifactsTool.execute("call-1", { stage: WorkflowStage.UserStories, hash }),
      ),
    ) as { productOverview: { name: string }; userStories?: unknown };
    assert.equal(recorded.productOverview.name, "Plant Pal");
    assert.ok(!("userStories" in recorded));
  });

  it("rejects predated and legacy reads with their own causes", async () => {
    const store = storeWithRecordedStories();
    const artifactsTool = buildReadTools(store).find(
      (tool) => tool.name === "get_stage_artifacts",
    );
    assert.ok(artifactsTool != null);
    const hash = store.stageInputFingerprints.get(WorkflowStage.UserStories);
    assert.ok(hash != null);
    // The stories snapshot predates requirements, so it holds none of them.
    await assert.rejects(
      () =>
        artifactsTool.execute("call-1", { stage: WorkflowStage.Requirements, hash }),
      /predates/,
    );
    // Test cases are no fingerprinted stage's input, so no version exists.
    await assert.rejects(
      () =>
        artifactsTool.execute("call-2", { stage: WorkflowStage.TestCases, hash }),
      /holds no recorded Test Cases/,
    );
    // A recorded hash with no readable content is a legacy recording.
    // Test-only write: the map changes through store actions in the app.
    unprotect(store);
    store.stageInputFingerprints.set(WorkflowStage.Requirements, "0".repeat(64));
    await assert.rejects(
      () =>
        artifactsTool.execute("call-3", {
          stage: WorkflowStage.Requirements,
          hash: "0".repeat(64),
        }),
      /before readable versions existed/,
    );
  });
});
