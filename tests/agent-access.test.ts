import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { agentToolDescriptions, callAgentTool } from "../app/ai-agent/agent-access";
import { formatQualityContract, qualityContractForStage } from "../app/ai-harness/workflow";
import { applyArtifactListProposal } from "../app/store/actions/ai-actions/utilities";
import { Priority, StructuralFragment, WorkflowStage } from "../app/store/constants";
import { Store } from "../app/store/store";

const OVERVIEW = {
  purpose: "Help people keep houseplants alive.",
  primaryFeatures: [{ content: "Track watering schedules" }],
  targetUsers: [{ content: "Busy plant owners" }],
};

/** A store whose approved overview has user stories built on it. */
async function storeWithStories(): Promise<Store> {
  const store = Store.create({ productOverview: {} });
  await callAgentTool(store, "submit_product_overview", { ...OVERVIEW, codesVersion: store.codesVersion });
  for (const unit of store.stageUnits(WorkflowStage.ProductOverview)) store.approve(unit.id);
  applyArtifactListProposal(store, {
    entityType: StructuralFragment.UserStory,
    items: [{
      key: "k0",
      id: "story-1",
      content: "As a plant owner, I want watering reminders.",
      priority: Priority.P1,
      dependencies: [],
      references: [{ id: store.productOverview.primaryFeatures[0]!.id, type: StructuralFragment.PrimaryFeature }],
    }],
  });
  return store;
}

function toolNames(store: Store): string[] {
  return agentToolDescriptions(store).map(({ name }) => name);
}

describe("outside agent tools", () => {
  it("offers the read tools and the submit tools of stages that can take work, never approval", () => {
    const store = Store.create({ productOverview: {} });
    const names = toolNames(store);
    assert.ok(names.includes("get_workflow_state"));
    assert.ok(names.includes("get_stage_artifacts"));
    assert.ok(names.includes("submit_product_overview"));
    // Later stages wait for the overview's approval; the person approves, not a tool.
    assert.ok(!names.some((name) => name.includes("user_stor")));
    assert.ok(!names.some((name) => name.includes("approve") || name === "communicate"));
    for (const { inputSchema } of agentToolDescriptions(store)) {
      assert.equal(inputSchema.type, "object");
    }
  });

  it("gives the agent the stage's quality contract, the one Requireganizer's writer and reviewer use", () => {
    const store = Store.create({ productOverview: {} });
    const submit = agentToolDescriptions(store).find(({ name }) => name === "submit_product_overview")!;
    assert.ok(submit.description.includes(formatQualityContract(qualityContractForStage(WorkflowStage.ProductOverview)!)));
  });

  it("leaves naming to the person: the overview takes no name", async () => {
    const store = Store.create({ productOverview: {} });
    const submit = agentToolDescriptions(store).find(({ name }) => name === "submit_product_overview")!;
    assert.equal((submit.inputSchema.properties as Record<string, unknown>).name, undefined);
    await assert.rejects(
      callAgentTool(store, "submit_product_overview", { codesVersion: store.codesVersion, ...OVERVIEW, name: "Plant Pal" }),
      /unsupported field\(s\): name/,
    );
    assert.equal(store.productOverview.isEmpty, true);
  });

  it("reads each unit's current status beside a signature that no longer holds", async () => {
    const store = await storeWithStories();
    store.approve("story-1");
    applyArtifactListProposal(store, {
      entityType: StructuralFragment.UserStory,
      items: [{
        key: "k0",
        id: "story-1",
        content: "As a plant owner, I want watering and feeding reminders.",
        priority: Priority.P1,
        dependencies: [],
        references: [{ id: store.productOverview.primaryFeatures[0]!.id, type: StructuralFragment.PrimaryFeature }],
      }],
    });
    const read = JSON.parse(await callAgentTool(store, "get_stage_artifacts", { stage: "user-stories" })) as {
      userStories: { id: string; signature: unknown }[];
      reviewStatus: { id: string; status: string }[];
    };
    assert.notEqual(read.userStories[0]!.signature, null);
    assert.deepEqual(
      read.reviewStatus.find(({ id }) => id === "story-1"),
      { id: "story-1", stage: WorkflowStage.UserStories, kind: "item", status: "draft" },
    );
  });

  it("applies a valid submission and says the person approves it", async () => {
    const store = Store.create({ productOverview: {} });
    const text = await callAgentTool(store, "submit_product_overview", { ...OVERVIEW, codesVersion: store.codesVersion });
    assert.match(text, /^Applied to Product Overview\. The person approves it/);
    assert.equal(store.productOverview.purpose, "Help people keep houseplants alive.");
    assert.equal(store.getStepStatus(WorkflowStage.ProductOverview), "needs-approval");
  });

  it("returns the validator's message for an invalid submission to the agent only, and changes nothing", async () => {
    const store = Store.create({ productOverview: {} });
    store.setValidationError({ message: "The person's own error." });
    await assert.rejects(
      () => callAgentTool(store, "submit_product_overview", { codesVersion: store.codesVersion, ...OVERVIEW, primaryFeatures: [] }),
      /primaryFeatures/,
    );
    assert.equal(store.productOverview.purpose, null);
    assert.equal(store.validationErrors, "The person's own error.");
  });

  it("takes items by the codes the page shows", async () => {
    const store = await storeWithStories();
    await callAgentTool(store, "submit_user_story_list", {
      codesVersion: store.codesVersion,
      items: [
        { item: "US-01", content: "As a plant owner, I want watering reminders on my phone." },
        {
          key: "feeding",
          content: "As a plant owner, I want feeding reminders.",
          priority: Priority.P2,
          references: ["FEA-01"],
          dependencies: ["US-01"],
        },
      ],
    });
    assert.deepEqual(
      store.userStories.map((story) => [story.getCode(), story.content]),
      [
        ["US-01", "As a plant owner, I want watering reminders on my phone."],
        ["US-02", "As a plant owner, I want feeding reminders."],
      ],
    );
    const feeding = store.userStories[1]!;
    assert.deepEqual(feeding.references.map(({ id }) => id), [store.productOverview.primaryFeatures[0]!.id]);
    assert.deepEqual(feeding.dependencies, ["story-1"]);
  });

  it("refuses a submission whose codes were read before the lists changed, and changes nothing", async () => {
    const store = await storeWithStories();
    const read = JSON.parse(await callAgentTool(store, "get_items", { stage: "user-stories" })) as { codesVersion: string };
    const before = read.codesVersion;
    await callAgentTool(store, "submit_user_story_list", {
      codesVersion: before,
      items: [
        { key: "first", content: "As a plant owner, I want a plant list.", priority: Priority.P1, references: ["FEA-01"], dependencies: [] },
        "US-01",
      ],
    });
    // US-01 now names the new story, so the old read must not patch it.
    await assert.rejects(
      () => callAgentTool(store, "submit_user_story_list", {
        codesVersion: before,
        items: [{ item: "US-01", content: "As a plant owner, I want watering reminders on my phone." }],
      }),
      /Codes may have moved since the get_items read/,
    );
    assert.deepEqual(
      store.userStories.map(({ content }) => content),
      ["As a plant owner, I want a plant list.", "As a plant owner, I want watering reminders."],
    );
  });

  it("says when Requireganizer is busy with other work", async () => {
    // As while a flow the person started runs.
    const store = Store.create({ productOverview: {}, businessCounter: 1 });
    store.beginAiOperation({ operation: "generate user stories", controller: new AbortController() });
    await assert.rejects(
      () => callAgentTool(store, "submit_product_overview", { ...OVERVIEW, codesVersion: store.codesVersion }),
      /^UserFacingError: Requireganizer is busy \(generate user stories\)\. Try again when it finishes\.$/,
    );
    assert.equal(store.productOverview.purpose, null);
  });

  it("names what to do for a tool that is not available", async () => {
    const store = Store.create({ productOverview: {} });
    await assert.rejects(
      () => callAgentTool(store, "submit_test_case_list", {}),
      /No tool named submit_test_case_list is available now\. A stage's submission tool appears once its earlier stages are approved\./,
    );
  });

  it("answers reads at once", async () => {
    const store = Store.create({ productOverview: {} });
    const state = JSON.parse(await callAgentTool(store, "get_workflow_state", {})) as { frontier: string };
    assert.equal(state.frontier, WorkflowStage.ProductOverview);
  });

  it("applies a submission that reopens an earlier stage for the person to approve", async () => {
    const store = await storeWithStories();
    const revised = { ...OVERVIEW, purpose: "Help people keep every houseplant alive." };
    const text = await callAgentTool(store, "submit_product_overview", { ...revised, codesVersion: store.codesVersion });
    assert.match(text, /^Applied to Product Overview\. The person approves it/);
    assert.equal(store.productOverview.purpose, revised.purpose);
    assert.equal(store.frontier, WorkflowStage.ProductOverview);
    // The next submission is not held up by the first.
    await callAgentTool(store, "submit_product_overview", { ...OVERVIEW, codesVersion: store.codesVersion });
    assert.equal(store.productOverview.purpose, OVERVIEW.purpose);
  });
});
