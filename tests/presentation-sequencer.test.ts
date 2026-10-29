import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reaction } from "mobx";
import { getSnapshot, type SnapshotIn } from "mobx-state-tree";

import {
  attachPresentation,
  claim,
  complete,
  getPresentationTick,
  isPresenting,
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
  timelineChangeSource,
  undo,
} from "../app/store/timeline/controller";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The shown primary features, the list frame that follows the purpose. */
function featureText(shown: Store): string {
  return shown.productOverview.primaryFeatures.map(({ content }) => content).join("\n");
}

function attachPair(
  step: WorkflowStage = WorkflowStage.ProductOverview,
  snapshot: SnapshotIn<typeof Store> = { productOverview: {} },
) {
  resetTimeline();
  resetPresentation();
  const real = Store.create(snapshot);
  const shown = Store.create(getSnapshot(real));
  attachTimeline(real);
  setPresentationNav({
    getStep: () => step,
    requestStep: () => {},
    isVisible: () => true,
  });
  attachPresentation(shown, real, timelineChangeSource);
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
      purpose: "Acme",
      primaryFeatures: [{ content: "Ship" }],
      targetUsers: [],
    } as never);

    assert.equal(shown.productOverview.purpose ?? "", "Acme");
    assert.equal(featureText(shown), "");
    const tick = getPresentationTick();
    claim(tick);
    complete(tick);
    assert.equal(featureText(shown), "Ship");
  });

  it("skips a frame when nothing claims within 100ms", async () => {
    declareTimelineStep("setProductOverview", {
      kind: "ai",
      label: "Generated product overview",
    });
    const { real, shown } = attachPair();

    real.setProductOverview({
      purpose: "Acme",
      primaryFeatures: [{ content: "Ship" }],
      targetUsers: [],
    } as never);
    assert.equal(featureText(shown), "");
    await delay(UNCLAIMED_MILLISECONDS + 30);
    assert.equal(featureText(shown), "Ship");
  });

  it("waits for every claim on a tick before advancing", () => {
    declareTimelineStep("setProductOverview", {
      kind: "ai",
      label: "Generated product overview",
    });
    const { real, shown } = attachPair();

    real.setProductOverview({
      purpose: "Acme",
      primaryFeatures: [{ content: "Ship" }],
      targetUsers: [],
    } as never);

    const tick = getPresentationTick();
    claim(tick);
    claim(tick);
    complete(tick);
    assert.equal(featureText(shown), "");
    complete(tick);
    assert.equal(featureText(shown), "Ship");
  });

  it("ignores stale claim/complete", async () => {
    declareTimelineStep("setProductOverview", {
      kind: "ai",
      label: "Generated product overview",
    });
    const { real, shown } = attachPair();

    real.setProductOverview({
      purpose: "Acme",
      primaryFeatures: [{ content: "Ship" }],
      targetUsers: [],
    } as never);
    const tick = getPresentationTick();
    complete(tick);
    claim(tick - 1);
    complete(tick - 1);
    assert.equal(featureText(shown), "");
    await delay(UNCLAIMED_MILLISECONDS + 30);
    assert.equal(featureText(shown), "Ship");
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
    attachPresentation(shown, real, timelineChangeSource);

    real.setProductOverview({
      purpose: "Acme",
      primaryFeatures: [{ content: "Ship" }],
      targetUsers: [],
    } as never);

    assert.deepEqual(requested, [WorkflowStage.ProductOverview]);
    assert.equal(shown.productOverview.purpose ?? "", "");

    step = WorkflowStage.ProductOverview;
    noteVisibleStep(WorkflowStage.ProductOverview);
    assert.equal(shown.productOverview.purpose ?? "", "Acme");
    assert.equal(featureText(shown), "");
  });

  it("mirrors human edits onto the replica immediately while idle", () => {
    declareTimelineStep("setPurpose", { kind: "user", label: "setPurpose" });
    const { real, shown } = attachPair();
    real.setPurpose({ purpose: "typed" });
    assert.equal(shown.productOverview.purpose ?? "", "typed");
  });

  it("presents approve through the sequencer", () => {
    const { real, shown } = attachPair();
    real.setPurpose({ purpose: "Acme" });
    assert.equal(shown.approvalOf("productOverview/purpose"), "draft");
    real.approve("productOverview/purpose");
    assert.equal(real.approvalOf("productOverview/purpose"), "approved");
    assert.equal(shown.approvalOf("productOverview/purpose"), "approved");
    assert.equal(isPresenting(), true);
    const tick = getPresentationTick();
    claim(tick);
    complete(tick);
    assert.equal(isPresenting(), false);
  });

  it("slides an approved removal out and an undo puts it back in its place", () => {
    const { real, shown } = attachPair(WorkflowStage.ProductOverview, {
      productOverview: {
        primaryFeatures: [
          { id: "f1", content: "one" },
          { id: "f2", content: "two", pendingRemoval: true },
          { id: "f3", content: "three" },
        ],
      },
    });
    const shownIds = () => shown.productOverview.primaryFeatures.map(({ id }) => id);
    const changes: { ids: string[]; presenting: boolean }[] = [];
    const stop = reaction(
      () => shownIds().join(","),
      () => changes.push({ ids: shownIds(), presenting: isPresenting() }),
    );
    const playAll = () => {
      while (isPresenting()) {
        const tick = getPresentationTick();
        claim(tick);
        complete(tick);
      }
    };
    real.approve("f2");
    playAll();
    undo();
    playAll();
    stop();
    // Each change plays as a frame, and the restored item enters where it
    // was: catching up with the real store moves nothing.
    assert.deepEqual(changes, [
      { ids: ["f1", "f3"], presenting: true },
      { ids: ["f1", "f2", "f3"], presenting: true },
    ]);
  });
});
