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
    { type: "add", stage: "module-overview", kind: "target-user", content: { name: "spec owner", description: "Decides." }, references: [], dependencies: [] },
  ]);
}

describe("workflow engine", () => {
  it("opens a stage once the stages it builds on are complete", () => {
    const store = Store.create({});
    assert.equal(store.stageOpen("user-stories"), false);
    assert.equal(store.stageProgress("module-overview"), "empty");
    overview(store);
    assert.equal(store.stageProgress("module-overview"), "in-progress");
    assert.throws(() => store.writeItems([{ type: "add", stage: "user-stories", kind: "user-story", content: { outcome: "x", reason: "y", priority: "P0" }, references: [], dependencies: [] }]));
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
    const user = itemOf(store, "module-overview", "USR-01");
    store.writeItems([{ type: "add", stage: "user-stories", kind: "user-story", content: { targetUsers: [user], outcome: "stages", reason: "order", priority: "P0" }, references: [feature], dependencies: [] }]);
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
    store.writeItems([{ type: "add", stage: "user-stories", kind: "user-story", content: { targetUsers: [user], outcome: "stories", reason: "tracing", priority: "P1" }, references: [feature], dependencies: [] }]);
    signAll(store, "user-stories");
    store.writeItems([{ type: "add", stage: "module-overview", kind: "target-user", content: { name: "agent", description: "Writes." }, references: [], dependencies: [] }]);
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

  it("holds Requirements engineering items in their parts and refuses them without what they need", async () => {
    const store = Store.create({});
    overview(store);
    assert.throws(
      () => store.writeItems([{ type: "add", stage: "module-overview", kind: "target-user", content: { name: "agent" }, references: [], dependencies: [] }]),
      /missing Description/,
    );
    store.writeItems([{ type: "add", stage: "module-overview", kind: "target-user", content: { name: "agent", description: "Writes." }, references: [], dependencies: [] }]);
    signAll(store, "module-overview");
    const feature = itemOf(store, "module-overview", "FEA-01");
    const owner = itemOf(store, "module-overview", "USR-01");
    const agent = itemOf(store, "module-overview", "USR-02");
    const story = (content: Record<string, unknown>, references: string[]) => () =>
      store.writeItems([{ type: "add", stage: "user-stories", kind: "user-story", content: content as never, references, dependencies: [] }]);
    assert.throws(story({ outcome: "a", reason: "b" }, [feature]), /missing Target users/);
    assert.throws(story({ targetUsers: [owner], reason: "b" }, [feature]), /missing Outcome/);
    assert.throws(story({ targetUsers: [owner], outcome: "a" }, [feature]), /missing Reason/);
    assert.throws(story({ targetUsers: [owner], outcome: "a", reason: "b" }, []), /references no primary feature/);
    assert.throws(story({ targetUsers: [owner], outcome: "a", reason: "b" }, [feature, owner]), /names its target users in Target users/);
    assert.throws(story({ targetUsers: [feature], outcome: "a", reason: "b" }, [feature]), /but it is a primary feature/);
    assert.throws(story({ targetUsers: [owner], outcome: "a", reason: "b", priority: "P3" }, [feature]), /must be one of P0, P1, P2/);
    story({ targetUsers: [owner, agent], outcome: "stages", reason: "order" }, [feature])();
    const written = itemOf(store, "user-stories", "US-01");
    assert.equal(store.textOf(written), "As a spec owner or agent, I want stages, so that order");
    assert.deepEqual(store.referencesOf(store.locate(written)!.item), [owner, agent, feature]);
    signAll(store, "user-stories");
    assert.equal(store.stageComplete("user-stories"), true);

    const requirement = (content: Record<string, unknown>, references: string[]) => () =>
      store.writeItems([{ type: "add", stage: "requirements", kind: "requirement", content: content as never, references, dependencies: [] }]);
    assert.throws(requirement({ obligation: "keep stages" }, []), /references no user story/);
    requirement({ obligation: "keep stages", priority: "P1" }, [written])();
    const kept = itemOf(store, "requirements", "REQ-01");
    assert.equal(store.textOf(kept), "The system must keep stages");
    signAll(store, "requirements");

    const criterion = (content: Record<string, unknown>, references: string[]) => () =>
      store.writeItems([{ type: "add", stage: "acceptance-criteria", kind: "acceptance-criterion", content: content as never, references, dependencies: [] }]);
    assert.throws(criterion({ when: "x", then: "y" }, [kept]), /missing Given/);
    assert.throws(criterion({ given: "x", when: "y" }, [kept]), /missing Then/);
    assert.throws(criterion({ given: "x", then: "y" }, []), /references no requirement/);
    assert.throws(criterion({ given: "x", then: "y", priority: "P0" }, [kept]), /has no field priority/);
    criterion({ given: "a stage", when: "", then: "it holds" }, [kept])();
    assert.equal(store.textOf(itemOf(store, "acceptance-criteria", "AC-01")), "Given a stage\nThen it holds");

    const state = JSON.parse(await callAgentTool(store, "get_workflow_state", {})) as { codesVersion: string };
    await assert.rejects(
      callAgentTool(store, "write_items", {
        codesVersion: state.codesVersion,
        changes: [{ action: "add", stage: "acceptance-criteria", fields: { given: "a", then: "" }, references: ["REQ-01"] }],
      }),
      /missing Then/,
    );
    const items = JSON.parse(await callAgentTool(store, "get_items", { stage: "user-stories", items: ["US-01"] })) as { items: { fields: { targetUsers: string[] }; text: string }[] };
    assert.deepEqual(items.items[0]!.fields.targetUsers, ["USR-01", "USR-02"]);
  });
});
