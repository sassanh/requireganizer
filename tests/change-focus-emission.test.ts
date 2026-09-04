import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { StructuralFragment } from "../app/store/constants";
import { Store } from "../app/store/store";
import type { Store as StoreInstance } from "../app/store/store";
import {
  attachTimeline,
  declareTimelineStep,
  onChangeFocus,
  resetTimeline,
  type ChangeFocusOp,
} from "../app/store/timeline/controller";

function story(id: string, content: string, referenceIds: string[] = []) {
  return {
    id,
    content,
    priority: null,
    references: referenceIds.map((referenceId) => ({
      id: referenceId,
      type: StructuralFragment.PrimaryFeature,
    })),
    dependencies: [],
  } as never;
}

function attachStore(): StoreInstance {
  resetTimeline();
  declareTimelineStep("setUserStories", {
    kind: "ai",
    label: "Generated user stories",
  });
  const store = Store.create({ productOverview: {} }) as unknown as StoreInstance;
  attachTimeline(store);
  return store;
}

function captureSubjects(run: () => void): string[] {
  const seen: ChangeFocusOp[] = [];
  const stop = onChangeFocus((focus) => {
    seen.push(...focus.ops);
  });
  try {
    run();
  } finally {
    stop();
  }
  return seen.map((op) => `${op.kind} ${op.subject}`);
}

describe("change focus emission", () => {
  it("emits one op for an added identity, never its descendants", () => {
    const store = attachStore();
    const subjects = captureSubjects(() => {
      store.setUserStories({
        userStories: [story("us-1", "one", ["feat-1", "feat-2"])],
      });
    });
    assert.deepEqual(subjects, ["add userStories/us-1"]);
  });

  it("emits one op for a removed identity, never its descendants", () => {
    const store = attachStore();
    store.setUserStories({
      userStories: [story("us-1", "one", ["feat-1", "feat-2"])],
    });
    const subjects = captureSubjects(() => {
      store.setUserStories({ userStories: [] });
    });
    assert.deepEqual(subjects, ["remove userStories/us-1"]);
  });

  it("emits one op for an own-level update, never its descendants", () => {
    const store = attachStore();
    store.setUserStories({
      userStories: [story("us-1", "one", ["feat-1"])],
    });
    const subjects = captureSubjects(() => {
      store.setUserStories({
        userStories: [story("us-1", "two", ["feat-1"])],
      });
    });
    assert.deepEqual(subjects, ["update userStories/us-1"]);
  });

  it("emits only nested ops for a nested-only update", () => {
    const store = attachStore();
    store.setUserStories({
      userStories: [story("us-1", "one", ["feat-1"])],
    });
    const subjects = captureSubjects(() => {
      store.setUserStories({
        userStories: [story("us-1", "one", ["feat-1", "feat-2"])],
      });
    });
    assert.deepEqual(subjects, [
      "add userStories/us-1/references/feat-2",
    ]);
  });

  it("emits the parent update alongside nested ops when both levels change", () => {
    const store = attachStore();
    store.setUserStories({
      userStories: [story("us-1", "one", ["feat-1"])],
    });
    const subjects = captureSubjects(() => {
      store.setUserStories({
        userStories: [story("us-1", "two", ["feat-1", "feat-2"])],
      });
    });
    assert.deepEqual(subjects, [
      "update userStories/us-1",
      "add userStories/us-1/references/feat-2",
    ]);
  });
});
