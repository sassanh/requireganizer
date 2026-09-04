import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getSnapshot } from "mobx-state-tree";

import {
  getMomentumFactor,
  getPresentationPace,
  maxPaceStep,
  momentumFactorFor,
  noteMomentumPlayed,
  setMomentumBacklog,
  settleMomentumPace,
} from "../app/presentation/momentum";
import {
  attachPresentation,
  claim,
  complete,
  getPresentationTick,
  getPresentingNavigate,
  isPresenting,
  noteVisibleStep,
  resetPresentation,
  setPresentationNav,
} from "../app/presentation/sequencer";
import { WorkflowStage } from "../app/store/constants";
import { Store } from "../app/store/store";
import type { Store as StoreInstance } from "../app/store/store";
import {
  attachTimeline,
  declareTimelineStep,
  resetTimeline,
} from "../app/store/timeline/controller";

describe("presentation momentum", () => {
  it("stays normal for short runs", () => {
    assert.equal(momentumFactorFor(5, 5), 1);
    assert.equal(momentumFactorFor(1, 5), 1);
    assert.equal(momentumFactorFor(3, 3), 1);
  });

  it("starts the first item normal even in a long run", () => {
    assert.equal(momentumFactorFor(20, 20), 1);
  });

  it("ramps up then cruises at up to three times normal", () => {
    assert.equal(momentumFactorFor(19, 20), 2);
    assert.equal(momentumFactorFor(18, 20), 3);
    assert.equal(momentumFactorFor(8, 10), 2);
  });

  it("eases the last items back to normal", () => {
    assert.equal(momentumFactorFor(4, 20), 3);
    assert.ok(Math.abs(momentumFactorFor(3, 20) - 7 / 3) < 1e-9);
    assert.ok(Math.abs(momentumFactorFor(2, 20) - 5 / 3) < 1e-9);
    assert.equal(momentumFactorFor(1, 20), 1);
  });

  it("never slows down when the run stretches", () => {
    setMomentumBacklog(0);
    // Play a run of eight down to two waiting, the way the queue reports it.
    for (let waiting = 8; waiting >= 2; waiting--) {
      setMomentumBacklog(waiting);
      settleMomentumPace();
      noteMomentumPlayed();
    }
    const before = getPresentationPace();
    // Eight land with two still waiting: the pace keeps climbing instead
    // of dipping back toward normal, and never leaps past one capped step.
    setMomentumBacklog(10);
    const after = settleMomentumPace();
    noteMomentumPlayed();
    assert.ok(after >= before);
    assert.ok(after - before <= maxPaceStep() + 1e-9);
    // Draining to empty lands back on normal.
    for (let waiting = 9; waiting >= 1; waiting--) {
      setMomentumBacklog(waiting);
      settleMomentumPace();
      noteMomentumPlayed();
    }
    setMomentumBacklog(0);
    assert.equal(getPresentationPace(), 1);
    assert.equal(getMomentumFactor(), 1);
  });

  it("opens normal again once the queue truly drains", () => {
    setMomentumBacklog(20);
    settleMomentumPace();
    noteMomentumPlayed();
    setMomentumBacklog(0);
    assert.equal(getMomentumFactor(), 1);
    setMomentumBacklog(6);
    assert.equal(settleMomentumPace(), 1);
    setMomentumBacklog(0);
  });
});

function eightStories(): { id: string; content: string }[] {
  return [
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
  ].map((content, index) => ({ id: `us-${index + 1}`, content }));
}

function attachPairOn(step: WorkflowStage): {
  real: StoreInstance;
  shown: StoreInstance;
  goTo: (next: WorkflowStage) => void;
} {
  resetTimeline();
  resetPresentation();
  const real = Store.create({ productOverview: {} }) as unknown as StoreInstance;
  const shown = Store.create(getSnapshot(real)) as unknown as StoreInstance;
  attachTimeline(real);
  let current = step;
  setPresentationNav({
    getStep: () => current,
    requestStep: () => {},
    isVisible: (next) => next === current,
  });
  attachPresentation(shown, real);
  return {
    real,
    shown,
    goTo: (next) => {
      current = next;
    },
  };
}

function drainTurns(limit = 40): void {
  for (let i = 0; i < limit && isPresenting(); i++) {
    const tick = getPresentationTick();
    claim(tick);
    complete(tick);
  }
}

describe("presentation rush boundaries", () => {
  it("starts the first visible item at normal pace after a tab switch", () => {
    declareTimelineStep("setUserStories", {
      kind: "ai",
      label: "Generated user stories",
    });
    const { real, goTo } = attachPairOn(WorkflowStage.ProductOverview);

    // The stories land while another tab shows: the run opens with a
    // navigate frame, which is the run's head — not one of its items.
    real.setUserStories({ userStories: eightStories() } as never);
    assert.equal(getPresentingNavigate(), WorkflowStage.UserStories);

    goTo(WorkflowStage.UserStories);
    noteVisibleStep(WorkflowStage.UserStories);

    // The first item the eye meets must read normal pace.
    assert.equal(getPresentationPace(), 1);
    drainTurns();
    assert.equal(isPresenting(), false);
    resetPresentation();
  });

  it("stretches one run across batches that land mid-run", () => {
    declareTimelineStep("setUserStories", {
      kind: "ai",
      label: "Generated user stories",
    });
    const { real } = attachPairOn(WorkflowStage.UserStories);

    real.setUserStories({ userStories: eightStories() } as never);
    // The first frame starts on arrival; presenting six more leaves one
    // queued and one presenting.
    for (let i = 0; i < 6; i++) {
      const tick = getPresentationTick();
      claim(tick);
      complete(tick);
    }
    assert.equal(isPresenting(), true);

    // A second batch lands mid-run: no fresh start, the run stretches to
    // nine and the next items keep climbing instead of reopening slow.
    const sixteen = [
      ...eightStories(),
      ...eightStories().map((story) => ({
        ...story,
        id: `${story.id}-b`,
      })),
    ];
    real.setUserStories({ userStories: sixteen } as never);
    // Each step after the landing keeps climbing toward the longer run:
    // never a dip, never a leap past one capped step.
    let previous = getPresentationPace();
    for (let i = 0; i < 2; i++) {
      const tick = getPresentationTick();
      claim(tick);
      complete(tick);
      const pace = getPresentationPace();
      assert.ok(pace >= previous);
      assert.ok(pace - previous <= maxPaceStep() + 1e-9);
      previous = pace;
    }

    // One run throughout: the slowdown lands only on the very last items.
    drainTurns(40);
    assert.equal(isPresenting(), false);
    assert.equal(getPresentationPace(), 1);
    resetPresentation();
  });

  it("gives bookkeeping-only changes no presentation frames", async () => {
    declareTimelineStep("setUserStories", {
      kind: "ai",
      label: "Generated user stories",
    });
    declareTimelineStep("markStageGenerated", {
      kind: "ai",
      label: "Generated user stories",
    });
    const { real, shown } = attachPairOn(WorkflowStage.UserStories);
    real.setUserStories({ userStories: eightStories().slice(0, 2) } as never);
    drainTurns();
    assert.equal(isPresenting(), false);

    // Stage fingerprints are bookkeeping no element presents: marking a
    // stage generated must queue no frames behind the visible items, or
    // the dead frames steal the run's slowdown.
    const tickBefore = getPresentationTick();
    real.markStageGenerated(WorkflowStage.UserStories);
    assert.equal(isPresenting(), false);
    assert.equal(getPresentationTick(), tickBefore);

    // The replica still catches up invisibly through the idle snapshot.
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      shown.stageInputFingerprints.get(WorkflowStage.UserStories),
      real.stageInputFingerprints.get(WorkflowStage.UserStories),
    );
    resetPresentation();
  });
});
