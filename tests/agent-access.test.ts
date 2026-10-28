import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { agentToolDescriptions, callAgentTool } from "../app/ai-agent/agent-access";
import { formatQualityContract, qualityContractForStage } from "../app/ai-harness/workflow";
import { applyArtifactListProposal } from "../app/store/actions/ai-actions/utilities";
import { Priority, StructuralFragment, WorkflowStage } from "../app/store/constants";
import { Store } from "../app/store/store";

const OVERVIEW = {
  purpose: "Help people keep houseplants alive.",
  primaryFeatures: ["Track watering schedules"],
  targetUsers: ["Busy plant owners"],
};

/** A store whose approved overview has user stories built on it. */
async function storeWithStories(): Promise<Store> {
  const store = Store.create({ productOverview: {} });
  await callAgentTool(store, "submit_product_overview", OVERVIEW);
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
      callAgentTool(store, "submit_product_overview", { ...OVERVIEW, name: "Plant Pal" }),
      /unsupported field\(s\): name/,
    );
    assert.equal(store.productOverview.isEmpty, true);
  });

  it("applies a valid submission and says the person approves it", async () => {
    const store = Store.create({ productOverview: {} });
    const text = await callAgentTool(store, "submit_product_overview", OVERVIEW);
    assert.match(text, /^Applied to Product Overview\. The person approves it/);
    assert.equal(store.productOverview.purpose, "Help people keep houseplants alive.");
    assert.equal(store.getStepStatus(WorkflowStage.ProductOverview), "needs-approval");
  });

  it("returns the validator's message for an invalid submission to the agent only, and changes nothing", async () => {
    const store = Store.create({ productOverview: {} });
    store.setValidationError({ message: "The person's own error." });
    await assert.rejects(
      () => callAgentTool(store, "submit_product_overview", { ...OVERVIEW, primaryFeatures: [] }),
      /primaryFeatures/,
    );
    assert.equal(store.productOverview.purpose, null);
    assert.equal(store.validationErrors, "The person's own error.");
  });

  it("says when Requireganizer is busy with other work", async () => {
    // As while a flow the person started runs.
    const store = Store.create({ productOverview: {}, businessCounter: 1 });
    store.beginAiOperation({ operation: "generate user stories", controller: new AbortController() });
    await assert.rejects(
      () => callAgentTool(store, "submit_product_overview", OVERVIEW),
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

  it("says a submission that reopens an earlier stage waits for the person, and refuses others meanwhile", async () => {
    const store = await storeWithStories();
    const revised = { ...OVERVIEW, purpose: "Help people keep every houseplant alive." };
    const text = await callAgentTool(store, "submit_product_overview", revised);
    assert.match(text, /^Not applied yet: the proposal sends the workflow back to Product Overview/);
    const waiting = store.pendingImpactChange;
    assert.ok(waiting != null);
    // Confirming the waiting change would replace whatever was applied since.
    await assert.rejects(
      () => callAgentTool(store, "submit_product_overview", OVERVIEW),
      /A proposal that reopens Product Overview waits for the person to confirm or cancel it/,
    );
    assert.equal(store.pendingImpactChange, waiting);
    assert.equal(store.productOverview.purpose, OVERVIEW.purpose);
  });
});
