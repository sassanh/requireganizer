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

  it("opens each stage once the stages it builds on are complete", () => {
    const store = Store.create({});
    assert.equal(store.stageOpen("capabilities"), false);
    assert.equal(store.stageOpen("features-and-target-users"), false);
    assert.equal(store.stageOpen("user-stories"), false);
    assert.equal(store.stageProgress("module-overview"), "empty");
    overview(store);
    assert.equal(store.stageProgress("module-overview"), "in-progress");
    assert.throws(() => store.writeItems([{ type: "add", stage: "capabilities", kind: "capability", content: { name: "x", description: "y" }, references: [], dependencies: [] }]));
    signAll(store, "module-overview");
    assert.equal(store.stageProgress("module-overview"), "complete");
    assert.equal(store.stageOpen("capabilities"), true);
    assert.equal(store.stageOpen("features-and-target-users"), false);

    store.writeItems([{ type: "add", stage: "capabilities", kind: "capability", content: { name: "Staging", description: "Staged workflow." }, references: [], dependencies: [] }]);
    assert.equal(store.stageProgress("capabilities"), "in-progress");
    assert.throws(() => store.writeItems([{ type: "add", stage: "features-and-target-users", kind: "target-user", content: { name: "x", description: "y" }, references: [], dependencies: [] }]));
    signAll(store, "capabilities");
    assert.equal(store.stageProgress("capabilities"), "complete");
    assert.equal(store.stageOpen("features-and-target-users"), true);
    assert.equal(store.stageOpen("user-stories"), false);

    const capability = itemOf(store, "capabilities", "CAP-01");
    store.writeItems([
      { type: "add", stage: "features-and-target-users", kind: "feature", content: { name: "Order", description: "Stages in order.", capability: [capability] }, references: [], dependencies: [] },
      { type: "add", stage: "features-and-target-users", kind: "target-user", content: { name: "spec owner", description: "Decides." }, references: [], dependencies: [] },
    ]);
    assert.equal(store.stageProgress("features-and-target-users"), "in-progress");
    assert.throws(() => store.writeItems([{ type: "add", stage: "user-stories", kind: "user-story", content: { outcome: "x", reason: "y", priority: "P0" }, references: [], dependencies: [] }]));
    signAll(store, "features-and-target-users");
    assert.equal(store.stageProgress("features-and-target-users"), "complete");
    assert.equal(store.stageOpen("user-stories"), true);
    assert.equal(store.stageOpen("requirements"), false);
  });

  it("asks for coverage, marks out of date, signs as it is, and asks for impacts", () => {
    const store = Store.create({});
    specified(store);
    const feature = itemOf(store, "features-and-target-users", "FEA-01");
    const user = itemOf(store, "features-and-target-users", "USR-01");
    store.writeItems([{ type: "add", stage: "user-stories", kind: "user-story", content: { targetUsers: [user], outcome: "stages", reason: "order", priority: "P0" }, references: [feature], dependencies: [] }]);
    const story = itemOf(store, "user-stories", "US-01");
    assert.equal(store.coverageStates("user-stories").length, 1);
    signAll(store, "user-stories");
    assert.equal(store.stageComplete("user-stories"), true);

    store.writeItems([{ type: "change", item: feature, content: { description: "Staged workflow, stage by stage." } }]);
    assert.equal(store.stageOpen("user-stories"), false);
    assert.deepEqual(store.itemState(story)!.outOfDateCauses.find(({ id }) => id === feature)!.reasons, ["changed", "not-approved"]);
    signAll(store, "features-and-target-users");
    assert.equal(store.stageOpen("user-stories"), true);
    assert.equal(store.itemState(story)!.outOfDate, true);
    assert.equal(store.itemState(story)!.waiting, "out-of-date");
    assert.equal(store.impactStates("user-stories").length, 1);
    store.sign(story);
    assert.equal(store.itemState(story)!.approved, true);
    signAll(store, "user-stories");
    assert.equal(store.stageComplete("user-stories"), true);
    assert.equal(store.impactStates("user-stories").length, 0);
  });

  it("holds a removal until it is signed and keeps a removed item until its impacts are signed", () => {
    const store = Store.create({});
    specified(store);
    const user = itemOf(store, "features-and-target-users", "USR-01");
    const feature = itemOf(store, "features-and-target-users", "FEA-01");
    store.writeItems([{ type: "add", stage: "user-stories", kind: "user-story", content: { targetUsers: [user], outcome: "stories", reason: "tracing", priority: "P1" }, references: [feature], dependencies: [] }]);
    signAll(store, "user-stories");
    store.writeItems([{ type: "add", stage: "features-and-target-users", kind: "target-user", content: { name: "agent", description: "Writes." }, references: [], dependencies: [] }]);
    const draft = itemOf(store, "features-and-target-users", "USR-02");
    store.writeItems([{ type: "remove", item: draft }]);
    assert.equal(store.locate(draft), null);
    store.writeItems([{ type: "add", stage: "features-and-target-users", kind: "target-user", content: { name: "agent", description: "Writes." }, references: [], dependencies: [] }]);
    signAll(store, "features-and-target-users");
    store.writeItems([{ type: "remove", item: user }]);
    assert.equal(store.itemState(user)!.phase, "proposed-removal");
    store.sign(user);
    assert.equal(store.itemState(user)!.phase, "removed");
    assert.equal(store.stageComplete("features-and-target-users"), true);
    const impact = store.impactStates("user-stories")[0]!;
    assert.equal(impact.after, null);
    store.sign(impact.unitId);
    assert.equal(store.locate(user), null);
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
      () => store.writeItems([{ type: "change", item: capability, content: { description: "Stages in a row." } }], [{ threadId: thread, text: "Renamed the capability." }]),
      /This write closes Features and Target Users/,
    );
    assert.equal(store.textOf(capability), "Staging: Staged workflow.");
    assert.equal(store.threadsWaitingForAnswerer.length, 1);
  });

  it("asks the coding agent to write the stage after a complete one until a write reaches it", async () => {
    const store = Store.create({});
    specified(store);
    assert.deepEqual(store.stagesToWriteAfter("features-and-target-users"), ["user-stories"]);
    store.askToWrite("user-stories");
    const state = JSON.parse(await callAgentTool(store, "get_workflow_state", {})) as { stagesWaitingForYou: { stage: string }[] };
    assert.deepEqual(state.stagesWaitingForYou.map(({ stage }) => stage), ["user-stories"]);
    store.writeItems([{
      type: "add",
      stage: "user-stories",
      kind: "user-story",
      content: { targetUsers: [itemOf(store, "features-and-target-users", "USR-01")], outcome: "see the stages in order", reason: "I know what comes next", priority: "P1" },
      references: [itemOf(store, "features-and-target-users", "FEA-01")],
      dependencies: [],
    }]);
    assert.deepEqual(store.writingAskedOfAnswerer, []);
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

  it("shows a requirement after the prefix its obligation declares", () => {
    const store = Store.create({});
    specified(store);
    const feature = itemOf(store, "features-and-target-users", "FEA-01");
    const owner = itemOf(store, "features-and-target-users", "USR-01");
    store.writeItems([
      { type: "add", stage: "user-stories", kind: "user-story", content: { targetUsers: [owner], outcome: "stages", reason: "order" }, references: [feature], dependencies: [] },
    ]);
    signAll(store, "user-stories");
    const story = itemOf(store, "user-stories", "US-01");
    store.writeItems([{ type: "add", stage: "requirements", kind: "requirement", content: { obligation: "keep stages" }, references: [story], dependencies: [] }]);
    const requirement = store.locate(itemOf(store, "requirements", "REQ-01"))!.item;
    assert.equal(store.workflow.prefixOf("requirement"), "The system must");
    assert.equal(store.displayOf(requirement.kind, requirement.content), "keep stages");
    assert.equal(store.textOf(requirement.id), "The system must keep stages");
    assert.equal(store.workflow.prefixOf("capability"), null);
  });

  it("publishes each stage's own rules, then the shared ones, as a list", async () => {
    const store = Store.create({});
    for (const stage of store.workflow.stageIds) {
      const published = JSON.parse(await callAgentTool(store, "get_stage_rules", { stage })) as { rules: string[] };
      assert.deepEqual(published.rules.slice(0, store.workflow.stage(stage).rules.length), store.workflow.stage(stage).rules);
      assert.ok(published.rules.at(-1)!.startsWith("An item is signed as it is shown"), `${stage} ends with the shared rules`);
    }
    const capabilities = JSON.parse(await callAgentTool(store, "get_stage_rules", { stage: "capabilities" })) as { kinds: { countsAsReferencing?: string[] }[] };
    assert.deepEqual(capabilities.kinds[0]!.countsAsReferencing, ["purpose"]);
  });
});
