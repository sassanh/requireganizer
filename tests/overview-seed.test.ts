import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PROJECT_SCHEMA_VERSION } from "../app/lib/projectSchema";
import { WorkflowStage } from "../app/store/constants";
import { Store, workflowFingerprint } from "../app/store/store";
import type { FlatStore } from "../app/store/store";

const emptyProject = {
  schemaVersion: PROJECT_SCHEMA_VERSION,
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

describe("overview seed as revision 0", () => {
  it("records the seed once and never overwrites it", () => {
    const store = Store.create({ productOverview: {} }) as unknown as FlatStore;
    assert.equal(store.overviewSeed, null);
    store.setOverviewSeed({ seed: "A plant care helper." });
    assert.equal(store.overviewSeed, "A plant care helper.");
    store.setOverviewSeed({ seed: "Something else entirely." });
    assert.equal(store.overviewSeed, "A plant care helper.");
  });

  it("keeps the seed out of workflow fingerprints", () => {
    const seeded = Store.create({ productOverview: {} }) as unknown as FlatStore;
    seeded.setOverviewSeed({ seed: "A plant care helper." });
    const plain = Store.create({ productOverview: {} }) as unknown as FlatStore;
    assert.equal(
      workflowFingerprint(seeded, WorkflowStage.UserStories),
      workflowFingerprint(plain, WorkflowStage.UserStories),
    );
  });

  it("carries the seed through an import round trip", () => {
    const reloaded = Store.create({ productOverview: {} }) as unknown as FlatStore & {
      import(value: unknown): void;
    };
    reloaded.import({ ...emptyProject, overviewSeed: "A plant care helper." });
    assert.equal(reloaded.overviewSeed, "A plant care helper.");
  });

  it("defaults a missing seed to null on import", () => {
    const reloaded = Store.create({ productOverview: {} }) as unknown as FlatStore & {
      import(value: unknown): void;
    };
    reloaded.import({ ...emptyProject });
    assert.equal(reloaded.overviewSeed, null);
  });
});
