import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { callAgentTool } from "../app/ai-agent/agent-access";
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

/** Writes a capability, then a feature under it and one target user, and signs every stage. */
function scope(store: Store): void {
  store.writeItems([
    { type: "add", stage: "capabilities", kind: "capability", content: { name: "Staging", description: "Staged workflow." }, references: [], dependencies: [] },
  ]);
  signAll(store, "capabilities");
  const capability = itemOf(store, "capabilities", "CAP-01");
  store.writeItems([
    { type: "add", stage: "features-and-target-users", kind: "feature", content: { name: "Order", description: "Stages in order.", capability: [capability] }, references: [], dependencies: [] },
    { type: "add", stage: "features-and-target-users", kind: "target-user", content: { name: "spec owner", description: "Decides." }, references: [], dependencies: [] },
  ]);
  signAll(store, "features-and-target-users");
}

/** A module whose Module Overview, Capabilities, and Features and Target Users are complete. */
function specified(store: Store): void {
  overview(store);
  signAll(store, "module-overview");
  scope(store);
}

describe("workflow engine", () => {
  it("refuses a write that changes a stage together with a stage that builds on it, in either order", () => {
    const store = Store.create({});
    specified(store);
    const capability = itemOf(store, "capabilities", "CAP-01");
    const feature = itemOf(store, "features-and-target-users", "FEA-01");
    const capabilityChange = { type: "change", item: capability, content: { description: "Stages in a row." } } as const;
    const featureChange = { type: "change", item: feature, content: { description: "Stages one by one." } } as const;
    for (const changes of [[capabilityChange, featureChange], [featureChange, capabilityChange]]) {
      assert.throws(() => store.writeItems([...changes]), /changes Capabilities and Features and Target Users, which builds on it/);
    }
    assert.equal(store.textOf(capability), "Staging: Staged workflow.");
    assert.equal(store.textOf(feature), "Order: Stages in order.");
  });

  it("names an item of this module or another, and tells listed links from counted ones", () => {
    const store = Store.create({});
    const other = Store.create({});
    store.setLinkedModules([{ id: "other", name: "Other", lookup: other.lookup }]);
    specified(store);
    overview(other);
    const purpose = itemOf(store, "module-overview", "PUR");
    const capability = itemOf(store, "capabilities", "CAP-01");
    const elsewhere = itemOf(other, "module-overview", "PUR");

    assert.deepEqual(store.namedItem(capability), {
      id: capability,
      module: null,
      code: "CAP-01",
      name: "CAP-01",
      kind: "capability",
      text: "Staging: Staged workflow.",
      stage: "capabilities",
      phase: "active",
      approved: true,
    });
    assert.deepEqual(store.namedItem(elsewhere), {
      id: elsewhere,
      module: { id: "other", name: "Other" },
      code: "PUR",
      name: "Other/PUR",
      kind: "purpose",
      text: "Owners get a trusted spec.",
      stage: "module-overview",
      phase: "active",
      approved: false,
    });
    assert.equal(store.namedItem("gone"), null);

    assert.deepEqual(store.linksOfVersion("capability", store.versionOf(capability)!, capability), {
      references: [],
      countedReferences: [purpose],
      dependencies: [],
      countedDependencies: [],
    });
  });

  it("keeps an open thread from counting as approved and lets the agent answer it", async () => {
    const store = Store.create({});
    specified(store);
    const feature = itemOf(store, "features-and-target-users", "FEA-01");
    const thread = store.requestChange(feature, "Name the stages.");
    assert.equal(store.itemState(feature)!.approved, false);
    assert.equal(store.threadsWaitingForAnswerer.length, 1);
    const state = JSON.parse(await callAgentTool(store, "get_workflow_state", {})) as { codesVersion: string };
    await callAgentTool(store, "write_items", {
      codesVersion: state.codesVersion,
      changes: [{ action: "change", item: "FEA-01", fields: { description: "Staged workflow: overview, stories, requirements, criteria." } }],
      answers: [{ threadId: thread, reply: "Named them." }],
    });
    assert.equal(store.threadsWaitingForAnswerer.length, 0);
    store.resolveThread(thread);
    store.sign(feature);
    assert.equal(store.itemState(feature)!.approved, true);
  });

  it("refuses, unchanged, a write that answers a thread in a stage the write closes", () => {
    const store = Store.create({});
    specified(store);
    const capability = itemOf(store, "capabilities", "CAP-01");
    const thread = store.requestChange(itemOf(store, "features-and-target-users", "FEA-01"), "Name the stages.");
    assert.throws(
      () => store.writeItems([{ type: "change", item: capability, content: { description: "Stages in a row." } }], { answers: [{ threadId: thread, text: "Renamed the capability." }], author: { kind: "agent", name: "test" } }),
      /This write closes Features and Target Users/,
    );
    assert.equal(store.textOf(capability), "Staging: Staged workflow.");
    assert.equal(store.threadsWaitingForAnswerer.length, 1);
  });

  it("reports each item written by the code the write named it by, with the code it moved to", async () => {
    const store = Store.create({});
    specified(store);
    store.writeItems(["Linking", "Tracing", "Naming"].map((name) => (
      { type: "add", stage: "capabilities", kind: "capability", content: { name, description: `${name} items.` }, references: [], dependencies: [] } as const
    )));
    const { codesVersion } = JSON.parse(await callAgentTool(store, "get_workflow_state", {})) as { codesVersion: string };
    const report = await callAgentTool(store, "write_items", {
      codesVersion,
      changes: [
        { action: "remove", item: "CAP-02" },
        { action: "remove", item: "CAP-03" },
        { action: "change", item: "CAP-04", fields: { description: "Names items." } },
        { action: "add", stage: "capabilities", fields: { name: "Ordering", description: "Orders items." } },
      ],
    });
    assert.match(report, /^Removed at once, never signed: CAP-02, CAP-03\.$/m);
    assert.match(report, /^Changed: CAP-04 \(now CAP-02\)\.$/m);
    assert.match(report, /^Added: CAP-03\.$/m);
  });

  it("holds each feature under one capability and shows it with the capability's name", () => {
    const store = Store.create({});
    specified(store);
    const capability = itemOf(store, "capabilities", "CAP-01");
    const user = itemOf(store, "features-and-target-users", "USR-01");
    const feature = (content: Record<string, unknown>) => () =>
      store.writeItems([{ type: "add", stage: "features-and-target-users", kind: "feature", content: content as never, references: [], dependencies: [] }]);

    assert.throws(feature({ name: "Show", description: "Shows the stages." }), /missing Capability/);
    assert.throws(feature({ description: "Shows the stages.", capability: [capability] }), /missing Name/);
    assert.throws(feature({ name: "Show", capability: [capability] }), /missing Description/);
    assert.throws(feature({ name: "Show", description: "Shows the stages.", capability: [user] }), /but it is a target user/);
    feature({ name: "Show", description: "Shows the stages.", capability: [capability] })();
    const added = itemOf(store, "features-and-target-users", "FEA-02");
    assert.equal(store.textOf(added), "Show: Shows the stages.");
    const location = store.locate(added)!.item;
    assert.deepEqual(store.chosenOf(location.kind, location.content), [
      { label: "Capability", items: [{ id: capability, code: store.codeOf(capability), name: "Staging" }] },
    ]);
    assert.deepEqual(store.referencesOf(store.locate(added)!.item), [capability]);
    assert.deepEqual(store.dependenciesOf(store.locate(added)!.item), []);
  });

  it("asks a reference rule only of the items it applies to, and counts no item whose removal is signed toward it", () => {
    const store = Store.create({});
    specified(store);
    const feature = itemOf(store, "features-and-target-users", "FEA-01");
    const targetUser = itemOf(store, "features-and-target-users", "USR-01");
    store.writeItems([
      { type: "add", stage: "needs", kind: "user-story", content: { targetUsers: [targetUser], outcome: "to sign stages in order", reason: "work rests on settled work", priority: "P1" }, references: [feature], dependencies: [] },
      { type: "add", stage: "needs", kind: "constraint", content: { limit: "Runs in a browser", source: "the product's distribution" }, references: [], dependencies: [] },
    ]);
    signAll(store, "needs");
    const story = itemOf(store, "needs", "US-01");
    const constraint = itemOf(store, "needs", "CON-01");
    const requirement = (type: string, references: string[]) => ({
      type: "add" as const,
      stage: "requirements",
      kind: "requirement",
      content: { obligation: "run in a browser.", type, priority: "P1" },
      references,
      dependencies: [],
    });

    store.writeItems([requirement("functional", [story])]);
    assert.throws(
      () => store.writeItems([requirement("constraint", [story])]),
      /references no constraint of this module; reference at least one, since its type is constraint\./,
    );
    // Referencing a constraint meets both rules, so an item referencing nothing is refused for the narrower one alone.
    assert.throws(
      () => store.writeItems([requirement("constraint", [])]),
      (error: Error) => !error.message.includes("user story") && error.message.includes("since its type is constraint"),
    );
    store.writeItems([requirement("constraint", [story, constraint])]);
    const bound = itemOf(store, "requirements", "REQ-02");

    store.writeItems([{ type: "remove", item: constraint }]);
    signAll(store, "needs");
    assert.throws(
      () => store.writeItems([{ type: "change", item: bound, content: { obligation: "run in every browser." } }]),
      /references no constraint of this module; reference at least one, since its type is constraint\./,
    );
  });

  it("asks for no impact in a stage that holds no item, and takes items in afresh once it is written again", () => {
    const store = Store.create({});
    specified(store);
    const capability = itemOf(store, "capabilities", "CAP-01");
    const feature = itemOf(store, "features-and-target-users", "FEA-01");
    const targetUser = itemOf(store, "features-and-target-users", "USR-01");
    store.writeItems([
      { type: "add", stage: "features-and-target-users", kind: "feature", content: { name: "Review", description: "Signing one by one.", capability: [capability] }, references: [], dependencies: [] },
    ]);
    signAll(store, "features-and-target-users");
    const unreferenced = itemOf(store, "features-and-target-users", "FEA-02");
    const story = (outcome: string) => ({
      type: "add" as const,
      stage: "needs",
      kind: "user-story",
      content: { targetUsers: [targetUser], outcome, reason: "work rests on settled work", priority: "P1" },
      references: [feature],
      dependencies: [],
    });
    store.writeItems([story("to sign stages in order")]);
    signAll(store, "needs");
    const impactsOf = (stage: string) => store.impactStates(stage).map(({ itemId }) => itemId);

    // A removal signed while Needs holds an item waits for Needs' impact on it.
    store.writeItems([{ type: "remove", item: unreferenced }]);
    signAll(store, "features-and-target-users");
    assert.deepEqual(impactsOf("needs"), [unreferenced]);

    // Once Needs holds no item, it asks for no impact, and the removed feature leaves.
    store.writeItems([{ type: "remove", item: itemOf(store, "needs", "US-01") }]);
    signAll(store, "needs");
    assert.equal(store.locate(unreferenced), null);
    store.writeItems([{ type: "change", item: capability, content: { description: "Staged, signed workflow." } }]);
    assert.deepEqual(impactsOf("needs"), []);

    // Written again, Needs takes in the capability as it is now, so the change asks nothing of it.
    signAll(store, "capabilities");
    signAll(store, "features-and-target-users");
    store.writeItems([story("to see what waits for me")]);
    assert.deepEqual(impactsOf("needs"), []);
  });

  it("counts each capability as referencing the purpose without listing it", () => {
    const store = Store.create({});
    overview(store);
    signAll(store, "module-overview");
    const purpose = itemOf(store, "module-overview", "PUR");
    assert.throws(
      () => store.writeItems([{ type: "add", stage: "capabilities", kind: "capability", content: { name: "Staging" }, references: [], dependencies: [] }]),
      /missing Description/,
    );
    assert.throws(
      () => store.writeItems([{ type: "add", stage: "capabilities", kind: "capability", content: { name: "Staging", description: "Staged workflow." }, references: [purpose], dependencies: [] }]),
      /counts as referencing it already/,
    );
    store.writeItems([{ type: "add", stage: "capabilities", kind: "capability", content: { name: "Staging", description: "Staged workflow." }, references: [], dependencies: [] }]);
    const capability = itemOf(store, "capabilities", "CAP-01");
    assert.equal(store.textOf(capability), "Staging: Staged workflow.");
    assert.deepEqual(store.referencesOf(store.locate(capability)!.item), [purpose]);
    const [coverage] = store.coverageStates("capabilities");
    assert.equal(coverage!.itemId, purpose);
    assert.deepEqual(coverage!.referencing, [capability]);
    signAll(store, "capabilities");
    assert.equal(store.stageComplete("capabilities"), true);

    store.writeItems([{ type: "change", item: purpose, content: { text: "Owners get a spec they trust." } }]);
    assert.deepEqual(store.itemState(capability)!.outOfDateCauses[0]!.reasons, ["changed", "not-approved"]);
  });
});
