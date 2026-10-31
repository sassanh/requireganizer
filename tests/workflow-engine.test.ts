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
    { type: "add", stage: "module-overview", kind: "primary-feature", content: { text: "Staged workflow." }, references: [], dependencies: [] },
    { type: "add", stage: "module-overview", kind: "target-user", content: { text: "Spec owner: decides." }, references: [], dependencies: [] },
  ]);
}

describe("workflow engine", () => {
  it("opens a stage once the stages it builds on are complete", () => {
    const store = Store.create({});
    assert.equal(store.stageOpen("user-stories"), false);
    assert.equal(store.stageProgress("module-overview"), "empty");
    overview(store);
    assert.equal(store.stageProgress("module-overview"), "in-progress");
    assert.throws(() => store.writeItems([{ type: "add", stage: "user-stories", kind: "user-story", content: { text: "x", priority: "p0" }, references: [], dependencies: [] }]));
    signAll(store, "module-overview");
    assert.equal(store.stageProgress("module-overview"), "complete");
    assert.equal(store.stageOpen("user-stories"), true);
    assert.equal(store.stageOpen("requirements"), false);
  });

  it("asks for coverage, marks out of date, signs as it is, and asks for impacts", () => {
    const store = Store.create({});
    overview(store);
    signAll(store, "module-overview");
    const feature = itemOf(store, "module-overview", "FEA-01");
    store.writeItems([{ type: "add", stage: "user-stories", kind: "user-story", content: { text: "As a spec owner, I want stages.", priority: "p0" }, references: [feature], dependencies: [] }]);
    const story = itemOf(store, "user-stories", "US-01");
    assert.equal(store.coverageStates("user-stories").length, 1);
    signAll(store, "user-stories");
    assert.equal(store.stageComplete("user-stories"), true);

    store.writeItems([{ type: "change", item: feature, content: { text: "Staged workflow, stage by stage." } }]);
    assert.equal(store.stageOpen("user-stories"), false);
    assert.deepEqual(store.itemState(story)!.outOfDateCauses[0]!.reasons, ["changed", "not-approved"]);
    signAll(store, "module-overview");
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
    overview(store);
    signAll(store, "module-overview");
    const user = itemOf(store, "module-overview", "USR-01");
    const feature = itemOf(store, "module-overview", "FEA-01");
    store.writeItems([{ type: "add", stage: "user-stories", kind: "user-story", content: { text: "Story", priority: "p1" }, references: [feature], dependencies: [] }]);
    signAll(store, "user-stories");
    store.writeItems([{ type: "add", stage: "module-overview", kind: "target-user", content: { text: "Agent: writes." }, references: [], dependencies: [] }]);
    const draft = itemOf(store, "module-overview", "USR-02");
    store.writeItems([{ type: "remove", item: draft }]);
    assert.equal(store.locate(draft), null);
    store.writeItems([{ type: "remove", item: user }]);
    assert.equal(store.itemState(user)!.phase, "proposed-removal");
    store.sign(user);
    assert.equal(store.itemState(user)!.phase, "removed");
    assert.equal(store.stageComplete("module-overview"), true);
    const impact = store.impactStates("user-stories")[0]!;
    assert.equal(impact.after, null);
    store.sign(impact.unitId);
    assert.equal(store.locate(user), null);
  });

  it("keeps an open thread from counting as approved and lets the agent answer it", async () => {
    const store = Store.create({});
    overview(store);
    signAll(store, "module-overview");
    const feature = itemOf(store, "module-overview", "FEA-01");
    const thread = store.requestChange(feature, "Name the stages.");
    assert.equal(store.itemState(feature)!.approved, false);
    assert.equal(store.threadsWaitingForAnswerer.length, 1);
    const state = JSON.parse(await callAgentTool(store, "get_workflow_state", {})) as { codesVersion: string };
    await callAgentTool(store, "write_items", {
      codesVersion: state.codesVersion,
      changes: [{ action: "change", item: "FEA-01", fields: { text: "Staged workflow: overview, stories, requirements, criteria." } }],
      answers: [{ threadId: thread, reply: "Named them." }],
    });
    assert.equal(store.threadsWaitingForAnswerer.length, 0);
    store.resolveThread(thread);
    store.sign(feature);
    assert.equal(store.itemState(feature)!.approved, true);
  });
});
