import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
});
