import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { agentToolDescriptions, callAgentTool } from "../app/ai-agent/agent-access";
import { Store } from "../app/store";

function itemOf(store: Store, stage: string, code: string): string {
  const id = store.itemsOf(stage).find(({ id: candidate }) => store.codeOf(candidate) === code)?.id;
  assert.ok(id != null, `${code} exists`);
  return id;
}

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
  ]);
}

/** Writes a capability, then a feature under it and two target users, each stage signed in turn. */
function scope(store: Store): void {
  store.writeItems([
    { type: "add", stage: "capabilities", kind: "capability", content: { name: "Staging", description: "Staged workflow." }, references: [], dependencies: [] },
  ]);
  signAll(store, "capabilities");
  const capability = itemOf(store, "capabilities", "CAP-01");
  store.writeItems([
    { type: "add", stage: "features-and-target-users", kind: "feature", content: { name: "Order", description: "Stages in order.", capability: [capability] }, references: [], dependencies: [] },
    { type: "add", stage: "features-and-target-users", kind: "target-user", content: { name: "owner", description: "Decides." }, references: [], dependencies: [] },
    { type: "add", stage: "features-and-target-users", kind: "target-user", content: { name: "agent", description: "Writes." }, references: [], dependencies: [] },
  ]);
  signAll(store, "features-and-target-users");
}

describe("reordering items", () => {
  it("puts a stage in a new order without changing versions or signatures", () => {
    const store = Store.create({});
    overview(store);
    signAll(store, "module-overview");
    scope(store);
    const before = store.itemsOf("features-and-target-users").map(({ id }) => id);
    const owner = itemOf(store, "features-and-target-users", "USR-01");
    const agent = itemOf(store, "features-and-target-users", "USR-02");
    const ownerRevision = store.revisionOf(owner);
    const agentRevision = store.revisionOf(agent);

    const outcome = store.reorderItems("features-and-target-users", [before[0]!, before[2]!, before[1]!]);

    assert.equal(outcome.reordered, true);
    assert.deepEqual(store.itemsOf("features-and-target-users").map(({ id }) => id), [before[0]!, before[2]!, before[1]!]);
    assert.equal(store.codeOf(agent), "USR-01");
    assert.equal(store.codeOf(owner), "USR-02");
    assert.equal(store.revisionOf(agent), agentRevision);
    assert.equal(store.revisionOf(owner), ownerRevision);
    assert.equal(store.itemState(agent)!.approved, true);
    assert.equal(store.itemState(owner)!.approved, true);
  });

  it("leaves an order that is already in place alone", () => {
    const store = Store.create({});
    overview(store);
    signAll(store, "module-overview");
    scope(store);
    const order = store.itemsOf("features-and-target-users").map(({ id }) => id);

    const outcome = store.reorderItems("features-and-target-users", order);

    assert.equal(outcome.reordered, false);
    assert.deepEqual(outcome.recoded, []);
    assert.deepEqual(store.itemsOf("features-and-target-users").map(({ id }) => id), order);
  });

  it("refuses an order that is not every item of the stage exactly once", () => {
    const store = Store.create({});
    overview(store);
    signAll(store, "module-overview");
    scope(store);
    const order = store.itemsOf("features-and-target-users").map(({ id }) => id);

    assert.throws(() => store.reorderItems("features-and-target-users", order.slice(1)), /Name every item of Features and Target Users once; the order leaves out FEA-01\./);
    assert.throws(() => store.reorderItems("features-and-target-users", [...order, order[0]!]), /FEA-01 appears more than once in the order\./);
    assert.throws(() => store.reorderItems("features-and-target-users", [...order, "missing"]), /missing is not an item of Features and Target Users\./);
    assert.throws(() => store.reorderItems("requirements", []), /Requirements is closed to reordering/);
  });

  it("reorders through the agent tool and reports the codes that moved", async () => {
    const store = Store.create({});
    overview(store);
    signAll(store, "module-overview");
    scope(store);
    assert.ok(agentToolDescriptions({}).some(({ name }) => name === "reorder_items"));
    const state = JSON.parse(await callAgentTool(store, "get_workflow_state", {})) as { codesVersion: string };

    const reply = await callAgentTool(store, "reorder_items", {
      codesVersion: state.codesVersion,
      stage: "features-and-target-users",
      order: ["FEA-01", "USR-02", "USR-01"],
    });

    assert.match(reply, /Reordered Features and Target Users\./);
    assert.match(reply, /USR-01 → USR-02/);
    assert.match(reply, /USR-02 → USR-01/);
    assert.match(reply, /codesVersion is now/);
    assert.deepEqual(store.itemsOf("features-and-target-users").map(({ id }) => store.codeOf(id)), ["FEA-01", "USR-01", "USR-02"]);
  });

  it("refuses codes read before an earlier write moved them", async () => {
    const store = Store.create({});
    overview(store);
    signAll(store, "module-overview");
    scope(store);
    const state = JSON.parse(await callAgentTool(store, "get_workflow_state", {})) as { codesVersion: string };
    store.reorderItems("features-and-target-users", [...store.itemsOf("features-and-target-users").map(({ id }) => id)].reverse());

    await assert.rejects(
      callAgentTool(store, "reorder_items", {
        codesVersion: state.codesVersion,
        stage: "features-and-target-users",
        order: ["FEA-01", "USR-01", "USR-02"],
      }),
      /codes moved since codesVersion/,
    );
  });
});
