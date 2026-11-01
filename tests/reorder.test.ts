import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { agentToolDescriptions, callAgentTool } from "../app/ai-agent/agent-access";
import { Store } from "../app/store";

function signAll(store: Store, stage: string): void {
  for (let round = 0; round < 5; round += 1) {
    for (const unit of store.stageUnits(stage)) {
      if (store.isSignable(unit.unitId)) store.sign(unit.unitId);
    }
  }
}

function overview(store: Store): void {
  store.writeItems([
    { type: "add", stage: "module-overview", kind: "purpose", content: { text: "Owners get a trusted spec." }, references: [], dependencies: [] },
    { type: "add", stage: "module-overview", kind: "primary-feature", content: { text: "Staged workflow." }, references: [], dependencies: [] },
    { type: "add", stage: "module-overview", kind: "target-user", content: { name: "owner", description: "Decides." }, references: [], dependencies: [] },
    { type: "add", stage: "module-overview", kind: "target-user", content: { name: "agent", description: "Writes." }, references: [], dependencies: [] },
  ]);
}

describe("reordering items", () => {
  it("puts a stage in a new order without changing versions or signatures", () => {
    const store = Store.create({});
    overview(store);
    signAll(store, "module-overview");
    const before = store.itemsOf("module-overview").map(({ id }) => id);
    const owner = store.itemsOf("module-overview").find(({ id }) => store.codeOf(id) === "USR-01")!;
    const agent = store.itemsOf("module-overview").find(({ id }) => store.codeOf(id) === "USR-02")!;
    const ownerRevision = store.revisionOf(owner.id);
    const agentRevision = store.revisionOf(agent.id);

    const outcome = store.reorderItems("module-overview", [before[0]!, before[1]!, agent.id, owner.id]);

    assert.equal(outcome.reordered, true);
    assert.deepEqual(store.itemsOf("module-overview").map(({ id }) => id), [before[0]!, before[1]!, agent.id, owner.id]);
    assert.equal(store.codeOf(agent.id), "USR-01");
    assert.equal(store.codeOf(owner.id), "USR-02");
    assert.equal(store.revisionOf(agent.id), agentRevision);
    assert.equal(store.revisionOf(owner.id), ownerRevision);
    assert.equal(store.itemState(agent.id)!.approved, true);
    assert.equal(store.itemState(owner.id)!.approved, true);
  });

  it("leaves an order that is already in place alone", () => {
    const store = Store.create({});
    overview(store);
    const order = store.itemsOf("module-overview").map(({ id }) => id);

    const outcome = store.reorderItems("module-overview", order);

    assert.equal(outcome.reordered, false);
    assert.deepEqual(outcome.recoded, []);
    assert.deepEqual(store.itemsOf("module-overview").map(({ id }) => id), order);
  });

  it("refuses an order that is not every item of the stage exactly once", () => {
    const store = Store.create({});
    overview(store);
    const order = store.itemsOf("module-overview").map(({ id }) => id);

    assert.throws(() => store.reorderItems("module-overview", order.slice(1)), /Name every item of Module Overview once; the order leaves out PUR\./);
    assert.throws(() => store.reorderItems("module-overview", [...order, order[0]!]), /PUR appears more than once in the order\./);
    assert.throws(() => store.reorderItems("module-overview", [...order, "missing"]), /missing is not an item of Module Overview\./);
    assert.throws(() => store.reorderItems("user-stories", []), /User Stories is closed to reordering/);
  });

  it("reorders through the agent tool and reports the codes that moved", async () => {
    const store = Store.create({});
    overview(store);
    assert.ok(agentToolDescriptions({}).some(({ name }) => name === "reorder_items"));
    const state = JSON.parse(await callAgentTool(store, "get_workflow_state", {})) as { codesVersion: string };

    const reply = await callAgentTool(store, "reorder_items", {
      codesVersion: state.codesVersion,
      stage: "module-overview",
      order: ["FEA-01", "PUR", "USR-02", "USR-01"],
    });

    assert.match(reply, /Reordered Module Overview\./);
    assert.match(reply, /USR-01 → USR-02/);
    assert.match(reply, /USR-02 → USR-01/);
    assert.match(reply, /codesVersion is now/);
    assert.deepEqual(store.itemsOf("module-overview").map(({ id }) => store.codeOf(id)), ["FEA-01", "PUR", "USR-01", "USR-02"]);
  });

  it("refuses codes read before an earlier write moved them", async () => {
    const store = Store.create({});
    overview(store);
    const state = JSON.parse(await callAgentTool(store, "get_workflow_state", {})) as { codesVersion: string };
    store.reorderItems("module-overview", [...store.itemsOf("module-overview").map(({ id }) => id)].reverse());

    await assert.rejects(
      callAgentTool(store, "reorder_items", {
        codesVersion: state.codesVersion,
        stage: "module-overview",
        order: ["PUR", "FEA-01", "USR-01", "USR-02"],
      }),
      /codes moved since codesVersion/,
    );
  });
});
