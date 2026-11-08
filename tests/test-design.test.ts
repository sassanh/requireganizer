import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { callAgentTool } from "../app/ai-agent/agent-access";
import { Store } from "../app/store";

function signAll(store: Store, stage: string): void {
  for (let round = 0; round < 5; round += 1) {
    for (const unit of store.stageUnits(stage)) {
      if (store.isSignable(unit.unitId)) store.sign(unit.unitId);
    }
  }
}

async function write(store: Store, changes: unknown[]): Promise<string> {
  const { codesVersion } = JSON.parse(await callAgentTool(store, "get_workflow_state", {})) as { codesVersion: string };
  return callAgentTool(store, "write_items", { codesVersion, changes });
}

/** A module whose Requirements engineering stages are complete, with two acceptance criteria. */
async function specified(): Promise<Store> {
  const store = Store.create({});
  await write(store, [
    { action: "add", stage: "module-overview", kind: "purpose", fields: { text: "Shoppers get their orders." } },
  ]);
  signAll(store, "module-overview");
  await write(store, [
    { action: "add", stage: "capabilities", kind: "capability", fields: { name: "Ordering", description: "Shoppers order what the shop holds." } },
  ]);
  signAll(store, "capabilities");
  await write(store, [
    { action: "add", stage: "features-and-target-users", kind: "feature", fields: { name: "Shoe orders", description: "Orders shoes.", capability: "CAP-01" } },
    { action: "add", stage: "features-and-target-users", kind: "target-user", fields: { name: "shopper", description: "Buys." } },
  ]);
  signAll(store, "features-and-target-users");
  await write(store, [{ action: "add", stage: "user-stories", fields: { targetUsers: ["USR-01"], outcome: "order", reason: "get shoes" }, references: ["FEA-01"] }]);
  signAll(store, "user-stories");
  await write(store, [{ action: "add", stage: "requirements", fields: { obligation: "refuse an order beyond stock" }, references: ["US-01"] }]);
  signAll(store, "requirements");
  await write(store, [
    { action: "add", stage: "acceptance-criteria", fields: { given: "1 shoe in stock", when: "a shopper orders 2", then: "the order is refused" }, references: ["REQ-01"] },
    { action: "add", stage: "acceptance-criteria", fields: { given: "a placed order", then: "its status is placed" }, references: ["REQ-01"] },
  ]);
  signAll(store, "acceptance-criteria");
  return store;
}

describe("test design", () => {
  it("holds a boundary and abstract tests, and refuses what breaks their rules", async () => {
    const store = await specified();
    assert.equal(store.stageOpen("boundary"), true);
    await assert.rejects(write(store, [{ action: "add", stage: "boundary", kind: "boundary-statement", fields: { actsOn: "the shop" } }]), /missing Starting state/);
    await write(store, [
      { action: "add", stage: "boundary", kind: "boundary-statement", fields: { actsOn: "the shop", startingState: "an empty shop" } },
      { action: "add", stage: "boundary", kind: "entity-type", fields: { name: "Order", meaning: "a shopper's order" } },
      { action: "add", stage: "boundary", kind: "word-set", fields: { name: "Status", words: ["placed", "sent"] } },
    ]);
    await assert.rejects(write(store, [{ action: "add", stage: "boundary", kind: "word-set", fields: { name: "order", words: [] } }]), (error: Error) => {
      assert.match(error.message, /missing Words/);
      return true;
    });
    await assert.rejects(write(store, [{ action: "add", stage: "boundary", kind: "word-set", fields: { name: "order", words: ["a"] } }]), /already ENT-01's/);
    const stock = { name: "stock", kind: "direct setup", phrase: "the shop holds {count} of {product}", inputs: [{ name: "count", type: { simple: "whole number" } }, { name: "product", type: { simple: "text" } }] };
    await assert.rejects(write(store, [{ action: "add", stage: "boundary", kind: "operation", fields: stock, references: ["AC-01"] }]), /needs its reason/);
    await assert.rejects(
      write(store, [{ action: "add", stage: "boundary", kind: "operation", fields: { ...stock, phrase: "the shop holds {count}", reason: "no restocking action" }, references: ["AC-01"] }]),
      /no place for the input product/,
    );
    await assert.rejects(write(store, [{ action: "add", stage: "boundary", kind: "operation", fields: { ...stock, reason: "none" } }]), /references no acceptance criterion/);
    await write(store, [
      { action: "add", stage: "boundary", kind: "operation", fields: { ...stock, reason: "no restocking action" }, references: ["AC-01"] },
      {
        action: "add",
        stage: "boundary",
        kind: "operation",
        fields: {
          name: "place order",
          kind: "action",
          phrase: "order {quantity} of {product}",
          inputs: [{ name: "quantity", type: { simple: "whole number" } }, { name: "product", type: { simple: "text" } }],
          result: { entity: "ENT-01" },
          refusals: [{ name: "out of stock", meaning: "too few in stock" }],
        },
        references: ["AC-01", "AC-02"],
      },
    ]);
    await assert.rejects(
      write(store, [{ action: "add", stage: "boundary", kind: "operation", fields: { name: "order status", kind: "observation", phrase: "the status of {order}", inputs: [{ name: "order", type: { entity: "ENT-01" } }] }, references: ["AC-02"] }]),
      /result cannot be none/,
    );
    await write(store, [
      { action: "add", stage: "boundary", kind: "operation", fields: { name: "order status", kind: "observation", phrase: "the status of {order}", inputs: [{ name: "order", type: { entity: "ENT-01" } }], result: { words: "SET-01" } }, references: ["AC-02"] },
    ]);
    const status = store.itemsOf("boundary").find((item) => store.codeOf(item.id) === "OP-03")!;
    const dependencies = store.dependenciesOf(status).map((id) => store.codeOf(id));
    assert.deepEqual([...dependencies].sort(), ["BND", "ENT-01", "SET-01"]);
    assert.match(store.textOf(status.id), /^Observation "order status": the status of \{order\}\nInputs: order, Order\nResult: Status/);
    signAll(store, "boundary");
    assert.equal(store.stageComplete("boundary"), true);
    assert.equal(store.stageOpen("abstract-tests"), true);

    const refusedTest = {
      criterion: "AC-01",
      given: [{ operation: "OP-01", inputs: [{ input: "count", literal: "1" }, { input: "product", literal: '"shoe"' }] }],
      when: [{ name: "order", operation: "OP-02", inputs: [{ input: "quantity", column: "quantity" }, { input: "product", literal: '"shoe"' }] }],
      then: [{ expects: "refusal", step: "order", refusal: "out of stock" }],
      columns: [{ name: "quantity", type: { simple: "whole number" } }],
      rows: [{ values: ["2"] }, { values: ["5"] }],
    };
    const add = (fields: Record<string, unknown>) => write(store, [{ action: "add", stage: "abstract-tests", fields }]);
    await assert.rejects(add({ ...refusedTest, then: [] }), /missing Then/);
    await assert.rejects(add({ ...refusedTest, when: [{ ...refusedTest.when[0], operation: "OP-01" }] }), /When step 1: Operation cannot be OP-01/);
    await assert.rejects(add({ ...refusedTest, criterion: "AC-02" }), /Given step 1: Operation cannot be OP-01/);
    await assert.rejects(add({ ...refusedTest, given: [{ ...refusedTest.given[0], inputs: [{ input: "count", literal: "one" }, { input: "product", literal: '"shoe"' }] }] }), /not a whole number/);
    await assert.rejects(add({ ...refusedTest, given: [{ ...refusedTest.given[0], inputs: [{ input: "count", literal: "1" }] }] }), /no value for the input product/);
    await assert.rejects(add({ ...refusedTest, rows: [{ values: ["2", "3"] }] }), /row 1 gives 2 values for 1 columns/);
    await assert.rejects(add({ ...refusedTest, then: [{ expects: "refusal", step: "order", refusal: "closed" }] }), /Refusal cannot be "closed"/);
    await add(refusedTest);
    const test = store.itemsOf("abstract-tests")[0]!;
    assert.equal(
      store.textOf(test.id),
      [
        "Verifies AC-01: Given 1 shoe in stock When a shopper orders 2 Then the order is refused",
        "",
        'Given (direct setup) the shop holds 1 of "shoe"',
        'When (action) order <quantity> of "shoe", as order',
        "Then order is refused with out of stock",
        "",
        "One test for each row:",
        "quantity",
        "2",
        "5",
      ].join("\n"),
    );
    assert.deepEqual(store.marksOf("abstract-test", test.content), ["Given uses a direct setup"]);
    assert.deepEqual(store.referencesOf(test).map((id) => store.codeOf(id)).sort(), ["AC-01", "OP-01", "OP-02"]);

    const statusTest = {
      criterion: "AC-02",
      given: [{ name: "placed", operation: "OP-02", inputs: [{ input: "quantity", literal: "1" }, { input: "product", literal: '"shoe"' }] }],
      then: [{ expects: "observation", operation: "OP-03", inputs: [{ input: "order", step: "placed" }], comparison: "equals", expected: { literal: "placed" } }],
    };
    await assert.rejects(
      add({ ...statusTest, then: [{ ...statusTest.then[0], comparison: "at most" }] }),
      /Comparison cannot be "at most": a Status is compared by equals, differs from/,
    );
    await assert.rejects(add({ ...statusTest, then: [{ ...statusTest.then[0], expected: { literal: "lost" } }] }), /lost is not a word of Status/);
    await assert.rejects(add({ ...statusTest, then: [{ ...statusTest.then[0], expected: { step: "placed" } }] }), /only when it compares an entity/);
    await add(statusTest);
    const rules = JSON.parse(await callAgentTool(store, "get_stage_rules", { stage: "abstract-tests" })) as { kinds: { exampleFields: unknown }[] };
    assert.ok(rules.kinds[0]!.exampleFields != null);
    const items = JSON.parse(await callAgentTool(store, "get_items", { stage: "abstract-tests" })) as { items: { fields: { given: { operation: string }[] } }[] };
    assert.deepEqual(items.items[1]!.fields.given[0]!.operation, "OP-02");
  });
});
