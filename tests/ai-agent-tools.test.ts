import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildResultTools,
} from "../app/ai-agent/result-tools";
import { WorkflowStage, StructuralFragment } from "../app/store/constants";
import { Store } from "../app/store/store";
import type { FlatStore } from "../app/store/store";

function emptyStore(): FlatStore {
  return Store.create({ productOverview: {} }) as unknown as FlatStore;
}

function resultTool(store: FlatStore, name: string) {
  const tools = buildResultTools(store, {
    kind: "generate",
    stage: WorkflowStage.ProductOverview,
  });
  const tool = tools.find(({ name: candidate }) => candidate === name);
  assert.ok(tool != null, `expected ${name} tool to be offered`);
  return tool;
}

describe("agent result tools", () => {
  it("always offers the communicate tool and routes questions to the store", async () => {
    const store = emptyStore();
    const tools = buildResultTools(store, {
      kind: "generate",
      stage: WorkflowStage.ProductOverview,
    });
    const communicate = tools.find(({ name }) => name === "communicate");
    assert.ok(communicate != null);

    await communicate.execute!(
      "call-1",
      { message: "What database should we target?" } as never,
    );
    assert.equal(store.systemMessage, "What database should we target?");
  });

  it("communicate rejects empty questions", async () => {
    const store = emptyStore();
    const communicate = resultTool(store, "communicate");
    await assert.rejects(
      () => communicate.execute!("call-1", { message: "  " } as never),
      /concise question is required/,
    );
  });

  it("applies a valid product-overview proposal to the store", async () => {
    const store = emptyStore();
    const submit = resultTool(store, "submit_product_overview");

    const response = await submit.execute!("call-1", {
      name: "Plant Pal",
      purpose: "Help people keep houseplants alive.",
      primaryFeatures: ["Track watering schedules"],
      targetUsers: ["Busy plant owners"],
    } as never);

    assert.match((response.content[0] as { text: string }).text, /applied/);
    assert.equal(store.productOverview.name, "Plant Pal");
    assert.deepEqual(
      store.productOverview.primaryFeatures.map(({ content }) => content),
      ["Track watering schedules"],
    );
  });

  it("rejects invalid product-overview proposals with a validator error", async () => {
    const store = emptyStore();
    const submit = resultTool(store, "submit_product_overview");

    await assert.rejects(
      () =>
        submit.execute!("call-1", {
          name: "Plant Pal",
          purpose: "Help people keep houseplants alive.",
          primaryFeatures: [],
          targetUsers: ["Busy plant owners"],
        } as never),
      (error: unknown) => error instanceof Error && error.message.length > 0,
    );
    assert.equal(store.productOverview.name, null);
  });

  it("applies fragment revisions through the comment flow", async () => {
    const store = emptyStore();
    store.initialize({
      name: "Calc",
      purpose: "Compute sums.",
      primaryFeatures: ["Add numbers"],
      targetUsers: [],
    });
    const featureId = store.productOverview.primaryFeatures[0]?.id;
    assert.ok(featureId != null);

    const commentTools = buildResultTools(store, {
      kind: "comment",
      fragment: "primary_feature" as never,
      id: featureId,
      comment: "Make it explicit.",
    });
    const revise = commentTools.find(({ name }) => name === "submit_fragment_revision");
    assert.ok(revise != null);

    await revise.execute!("call-1", {
      patch: { content: "Add two numbers" },
    } as never);

    assert.equal(
      store.productOverview.primaryFeatures[0]?.content,
      "Add two numbers",
    );
  });

  it("drops an artifact through the comment flow", async () => {
    const store = emptyStore();
    store.initialize({
      name: "Calc",
      purpose: "Compute sums.",
      primaryFeatures: ["Add numbers", "Subtract numbers"],
      targetUsers: [],
    });
    const featureId = store.productOverview.primaryFeatures[0]?.id;
    assert.ok(featureId != null);

    const commentTools = buildResultTools(store, {
      kind: "comment",
      fragment: "primary_feature" as never,
      id: featureId,
      comment: "Drop this feature.",
    });
    const revise = commentTools.find(({ name }) => name === "submit_fragment_revision");
    assert.ok(revise != null);

    await revise.execute!("call-2", {
      patch: { remove: true },
    } as never);

    assert.equal(store.productOverview.primaryFeatures.length, 2);
    assert.equal(store.productOverview.primaryFeatures[0]?.pendingRemoval, true);
    store.approve(featureId);
    assert.equal(store.productOverview.primaryFeatures.length, 1);
    assert.equal(
      store.productOverview.primaryFeatures[0]?.content,
      "Subtract numbers",
    );
  });
});
