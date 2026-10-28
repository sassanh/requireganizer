import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { getSnapshot } from "mobx-state-tree";

import { parseProjectPayload, pickActiveModule } from "../app/lib/moduleSchema";
import { MODULE_SCHEMA_VERSION } from "../app/lib/projectSchema";
import {
  OVERVIEW_PURPOSE_QUALITY_ID,
  WorkflowStage,
} from "../app/store/constants";
import { coverageUnitId } from "../app/store/review";
import { createModuleStore } from "../app/store/store";

/**
 * Written by the schema 3 code itself: overview, stories, and requirement
 * REQ-1 approved and current; REQ-2 rewritten after approval; both criteria
 * approved before that rewrite, so schema 3 showed their stage outdated.
 */
function schema3Module(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve("tests/fixtures/schema-3-module.json"), "utf8"),
  ) as Record<string, unknown>;
}

describe("schema 3 migration", () => {
  it("keeps approvals of work schema 3 showed current", () => {
    const store = createModuleStore(schema3Module());
    for (const id of [
      OVERVIEW_PURPOSE_QUALITY_ID,
      "feat-1",
      "feat-2",
      "user-1",
      "story-1",
      "story-2",
      "req-1",
    ]) {
      assert.equal(store.approvalOf(id), "approved", id);
    }
    assert.equal(store.reviewUnit("story-1")!.signature!.reviewer.kind, "person");
  });

  it("keeps a rewritten draft as draft with its signed text", () => {
    const store = createModuleStore(schema3Module());
    assert.equal(store.approvalOf("req-2"), "draft");
    assert.equal(
      store.signedTextOf("req-2"),
      "The system must remind owners when feeding is due.",
    );
    assert.equal(store.canRestore("req-2"), false, "Requirements is not the frontier yet");
  });

  it("leaves work schema 3 showed outdated outdated, never approved", () => {
    const store = createModuleStore(schema3Module());
    assert.deepEqual(store.outdatedItemIds(WorkflowStage.AcceptanceCriteria), ["ac-1", "ac-2"]);
    assert.equal(store.approvalOf("ac-1"), "draft");
    assert.equal(store.review.acknowledgedInputs[WorkflowStage.AcceptanceCriteria], undefined);
    assert.ok(store.review.acknowledgedInputs[WorkflowStage.Requirements] != null);
  });

  it("asks for the coverage approvals schema 3 never recorded", () => {
    const store = createModuleStore(schema3Module());
    assert.equal(store.frontier, WorkflowStage.UserStories);
    store.approve(coverageUnitId("feat-1"));
    store.approve(coverageUnitId("feat-2"));
    assert.equal(store.frontier, WorkflowStage.Requirements);
    store.restoreSigned("req-2");
    store.approve(coverageUnitId("story-1"));
    store.approve(coverageUnitId("story-2"));
    assert.equal(store.frontier, WorkflowStage.AcceptanceCriteria);
  });

  it("stores the migrated module in the current schema", () => {
    const store = createModuleStore(schema3Module());
    const snapshot = getSnapshot(store) as Record<string, unknown>;
    assert.equal(snapshot.schemaVersion, MODULE_SCHEMA_VERSION);
    assert.equal("stageInputFingerprints" in snapshot, false);
    const reloaded = createModuleStore(JSON.parse(JSON.stringify(snapshot)));
    assert.equal(reloaded.approvalOf("req-1"), "approved");
    assert.deepEqual(reloaded.outdatedItemIds(WorkflowStage.AcceptanceCriteria), ["ac-1", "ac-2"]);
  });

  it("opens a bare schema 3 module through the project reader", () => {
    const payload = parseProjectPayload(schema3Module());
    const store = createModuleStore(pickActiveModule(payload).snapshot);
    assert.equal(store.approvalOf("story-1"), "approved");
  });
});
