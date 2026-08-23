import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getSnapshot } from "mobx-state-tree";

import {
  assertCurrentProjectSchema,
  PROJECT_SCHEMA_VERSION,
} from "../app/lib/projectSchema";

const emptyProject = {
  schemaVersion: PROJECT_SCHEMA_VERSION,
  description: "A contract-first project.",
  productOverview: {
    name: null,
    purpose: null,
    primaryFeatures: [],
    targetUsers: [],
  },
  userStories: [],
  requirements: [],
  acceptanceCriteria: [],
  boundaryDesign: null,
  implementationProfile: null,
  contractSuite: null,
  testScenarios: [],
  projectSetup: null,
  scaffoldFiles: [],
  stageInputFingerprints: {},
};

describe("project schema import", () => {
  it("accepts schema version 2 and rejects obsolete data clearly", () => {
    assert.doesNotThrow(() => assertCurrentProjectSchema(emptyProject));
    assert.throws(
      () => assertCurrentProjectSchema({ ...emptyProject, schemaVersion: 1 }),
      /obsolete project schema 1.*schema 2 only/,
    );
  });

  it("restores kept conversation branches through the store import", async () => {
    const { Store } = await import("../app/store/store");
    const { makeConversationBranchRecord } = await import(
      "../app/store/conversation-branches"
    );

    const store = Store.create({ productOverview: {} });
    const prefix = [
      { role: "user", content: [{ type: "text", text: "anchor" }], timestamp: 1 },
    ];
    const tail = [
      { role: "assistant", content: [{ type: "text", text: "kept answer" }], timestamp: 2 },
    ];
    store.setConversation([...prefix, ...tail]);
    const branchRecord = makeConversationBranchRecord(prefix, tail);
    store.putConversationBranch(branchRecord);

    // Round-trip through plain JSON exactly like the localStorage autosave.
    const payload = JSON.parse(JSON.stringify(getSnapshot(store)));

    const reloaded = Store.create({ productOverview: {} });
    reloaded.import(payload);

    assert.equal(reloaded.conversationBranches.length, 1);
    assert.equal(reloaded.conversationBranches[0].id, branchRecord.id);
    assert.deepEqual(reloaded.conversationBranches[0].messages, tail);
  });

  it("rejects malformed branch records on import", async () => {
    const { Store } = await import("../app/store/store");
    const store = Store.create({ productOverview: {} });
    const broken = [
      {
        id: "branch-1",
        createdAt: "not-a-number",
        baseLength: 1,
        baseFingerprint: "deadbeef",
        messages: [],
      },
    ];

    assert.throws(
      () => store.import({
        ...emptyProject,
        conversation: [],
        conversationBranches: broken,
      }),
      /invalid creation time/,
    );
  });
});
