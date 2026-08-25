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
      /obsolete project schema 1.*schema 3 only/,
    );
  });

  it("keeps the pending system message through an import round trip", async () => {
    const { Store } = await import("../app/store/store");
    const message = "Which evaluation rule should I document?";
    const payload = JSON.parse(JSON.stringify({
      ...emptyProject,
      systemMessage: message,
    }));

    const reloaded = Store.create({ productOverview: {} }) as unknown as {
      import(value: unknown): void;
      systemMessage: string | null;
    };
    reloaded.import(payload);

    assert.equal(reloaded.systemMessage, message);
  });
});
