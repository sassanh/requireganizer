import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getSnapshot } from "mobx-state-tree";

import {
  attachPresentation,
  noteVisibleStep,
  resetPresentation,
  setPresentationNav,
} from "../app/presentation/sequencer";
import { WorkflowStage } from "../app/store/constants";
import { Store } from "../app/store/store";
import {
  attachTimeline,
  declareTimelineStep,
  resetTimeline,
} from "../app/store/timeline/controller";

describe("change focus navigation", () => {
  it("switches to the owning step before applying that step's values", () => {
    resetTimeline();
    resetPresentation();
    declareTimelineStep("setProductOverview", {
      kind: "ai",
      label: "Generated product overview",
    });

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
    assert.equal(
      shown.productOverview.name ?? "",
      "",
      "values wait until the navigate frame completes",
    );

    step = WorkflowStage.ProductOverview;
    noteVisibleStep(WorkflowStage.ProductOverview);

    assert.equal(shown.productOverview.name ?? "", "Acme");
  });
});
