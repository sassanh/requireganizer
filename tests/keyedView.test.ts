import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { observable, runInAction } from "mobx";

import { cachedView, keyedView } from "../app/store/keyedView";

describe("keyed views", () => {
  it("derives once per key between unobserved reads", () => {
    const values = observable.map<string, number>({ a: 1, b: 2 });
    const derived: string[] = [];
    const doubled = keyedView((key: string) => {
      derived.push(key);
      return (values.get(key) ?? 0) * 2;
    });

    assert.equal(doubled("a"), 2);
    assert.equal(doubled("a"), 2);
    assert.equal(doubled("b"), 4);
    assert.deepEqual(derived, ["a", "b"]);
  });

  it("derives a key again only after what it read changes", () => {
    const values = observable.map<string, number>({ a: 1, b: 2 });
    const derived: string[] = [];
    const doubled = keyedView((key: string) => {
      derived.push(key);
      return (values.get(key) ?? 0) * 2;
    });
    doubled("a");
    doubled("b");

    runInAction(() => values.set("a", 5));

    assert.equal(doubled("a"), 10);
    assert.equal(doubled("b"), 4);
    assert.deepEqual(derived, ["a", "b", "a"]);
  });

  it("keeps a view without a key cached the same way", () => {
    const state = observable({ count: 1 });
    let derivations = 0;
    const tripled = cachedView(() => {
      derivations += 1;
      return state.count * 3;
    });

    assert.equal(tripled(), 3);
    assert.equal(tripled(), 3);
    runInAction(() => (state.count = 2));
    assert.equal(tripled(), 6);
    assert.equal(derivations, 2);
  });
});
