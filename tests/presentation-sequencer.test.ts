import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getSnapshot } from "mobx-state-tree";

import {
  attachPresentation,
  claim,
  complete,
  getPresentationTick,
  noteVisibleStep,
  resetPresentation,
  setPresentationNav,
  UNCLAIMED_MILLISECONDS,
} from "../app/presentation/sequencer";
import { WorkflowStage } from "../app/store/constants";
import { Store } from "../app/store/store";
import {
  attachTimeline,
  declareTimelineStep,
  resetTimeline,
} from "../app/store/timeline/controller";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function attachPair(step: WorkflowStage = WorkflowStage.ProductOverview) {
  resetTimeline();
  resetPresentation();
  const real = Store.create({ productOverview: {} });
  const shown = Store.create(getSnapshot(real));
  attachTimeline(real);
  setPresentationNav({
    getStep: () => step,
    requestStep: () => {},
    isVisible: () => true,
  });
  attachPresentation(shown, real);
  return { real, shown };
}

describe("presentation sequencer", () => {
  it("applies one value at a time and waits for claim/complete", () => {
    declareTimelineStep("setProductOverview", {
      kind: "ai",
      label: "Generated product overview",
    });
    const { real, shown } = attachPair();

    real.setProductOverview({
      name: "Acme",
      purpose: "Ship",
      primaryFeatures: [],
      targetUsers: [],
    } as never);

    assert.equal(shown.productOverview.name ?? "", "Acme");
    assert.equal(shown.productOverview.purpose ?? "", "");
    const tick = getPresentationTick();
    claim(tick);
    complete(tick);
    assert.equal(shown.productOverview.purpose ?? "", "Ship");
  });

  it("skips a frame when nothing claims within 100ms", async () => {
    declareTimelineStep("setProductOverview", {
      kind: "ai",
      label: "Generated product overview",
    });
    const { real, shown } = attachPair();

    real.setProductOverview({
      name: "Acme",
      purpose: "Ship",
      primaryFeatures: [],
      targetUsers: [],
    } as never);
    assert.equal(shown.productOverview.purpose ?? "", "");
    await delay(UNCLAIMED_MILLISECONDS + 30);
    assert.equal(shown.productOverview.purpose ?? "", "Ship");
  });

  it("waits for every claim on a tick before advancing", () => {
    declareTimelineStep("setProductOverview", {
      kind: "ai",
      label: "Generated product overview",
    });
    const { real, shown } = attachPair();

    real.setProductOverview({
      name: "Acme",
      purpose: "Ship",
      primaryFeatures: [],
      targetUsers: [],
    } as never);

    const tick = getPresentationTick();
    claim(tick);
    claim(tick);
    complete(tick);
    assert.equal(shown.productOverview.purpose ?? "", "");
    complete(tick);
    assert.equal(shown.productOverview.purpose ?? "", "Ship");
  });

  it("ignores stale claim/complete", async () => {
    declareTimelineStep("setProductOverview", {
      kind: "ai",
      label: "Generated product overview",
    });
    const { real, shown } = attachPair();

    real.setProductOverview({
      name: "Acme",
      purpose: "Ship",
      primaryFeatures: [],
      targetUsers: [],
    } as never);
    const tick = getPresentationTick();
    complete(tick);
    claim(tick - 1);
    complete(tick - 1);
    assert.equal(shown.productOverview.purpose ?? "", "");
    await delay(UNCLAIMED_MILLISECONDS + 30);
    assert.equal(shown.productOverview.purpose ?? "", "Ship");
  });

  it("keeps remaining adds in line when a later change queues removes", () => {
    declareTimelineStep("setUserStories", {
      kind: "ai",
      label: "Generated user stories",
    });
    const { real, shown } = attachPair(WorkflowStage.UserStories);

    real.setUserStories({
      userStories: [
        { id: "us-1", content: "one" },
        { id: "us-2", content: "two" },
        { id: "us-3", content: "three" },
      ],
    });
    assert.equal(shown.userStories.length, 1);
    assert.equal(shown.userStories[0]?.content, "one");

    real.setUserStories({ userStories: [] });
    assert.equal(shown.userStories.length, 1);

    const play = () => {
      const tick = getPresentationTick();
      claim(tick);
      complete(tick);
    };
    play();
    assert.deepEqual(
      shown.userStories.map((item) => item.content),
      ["one", "two"],
    );
    play();
    assert.deepEqual(
      shown.userStories.map((item) => item.content),
      ["one", "two", "three"],
    );
    play();
    assert.deepEqual(
      shown.userStories.map((item) => item.content),
      ["one", "two"],
    );
    play();
    assert.deepEqual(
      shown.userStories.map((item) => item.content),
      ["one"],
    );
    play();
    assert.deepEqual(
      shown.userStories.map((item) => item.content),
      [],
    );
  });

  it("inserts a navigate frame and waits until that step is visible", () => {
    declareTimelineStep("setProductOverview", {
      kind: "ai",
      label: "Generated product overview",
    });
    resetTimeline();
    resetPresentation();
    const real = Store.create({ productOverview: {} });
    const shown = Store.create(getSnapshot(real));
    attachTimeline(real);
    let step = WorkflowStage.Requirements;
    const requested: WorkflowStage[] = [];
    setPresentationNav({
      getStep: () => step,
      requestStep: (next) => {
        requested.push(next);
      },
      isVisible: (next) => next === step,
    });
    attachPresentation(shown, real);

    real.setProductOverview({
      name: "Acme",
      purpose: "Ship",
      primaryFeatures: [],
      targetUsers: [],
    } as never);

    assert.deepEqual(requested, [WorkflowStage.ProductOverview]);
    assert.equal(shown.productOverview.name ?? "", "");

    step = WorkflowStage.ProductOverview;
    noteVisibleStep(WorkflowStage.ProductOverview);
    assert.equal(shown.productOverview.name ?? "", "Acme");
    assert.equal(shown.productOverview.purpose ?? "", "");
  });

  it("mirrors human edits onto the replica immediately while idle", () => {
    declareTimelineStep("setName", { kind: "user", label: "setName" });
    const { real, shown } = attachPair();
    real.setName({ name: "typed" });
    assert.equal(shown.productOverview.name ?? "", "typed");
  });
});
