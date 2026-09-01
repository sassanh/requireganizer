import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fingerprint } from "../app/contract-domain";
import {
  assertCurrentProjectSchema,
  PROJECT_SCHEMA_VERSION,
} from "../app/lib/projectSchema";

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

  it("does not rewrite a draft revision to approved", async () => {
    const { Store } = await import("../app/store/store");
    const reloaded = Store.create({ productOverview: {} }) as unknown as {
      import(value: unknown): void;
      boundaryDesign: { status: string } | null;
    };
    const emptyRevisionId = fingerprint([]);
    reloaded.import({
      ...emptyProject,
      boundaryDesign: {
        id: "boundary",
        revisionId: "boundary-r1",
        revision: 1,
        status: "draft",
        createdAt: "2026-08-13T00:00:00.000Z",
        requirementsRevisionId: emptyRevisionId,
        acceptanceCriteriaRevisionId: emptyRevisionId,
        rootSubjectId: "product",
        subjects: [
          {
            id: "product",
            name: "Plant Pal",
            purpose: "Keep plants alive",
            classification: "external",
            parentSubjectId: null,
            responsibilities: ["Remind"],
            exclusions: [],
            lifecycle: "fresh_per_case",
            requirementIds: [],
            acceptanceCriteriaIds: [],
          },
        ],
        interfaces: [],
        interactions: [],
        verificationObligations: [],
        coverage: [],
      },
    });
    assert.equal(reloaded.boundaryDesign?.status, "draft");
  });

  it("ignores a leftover description field and does not persist it", async () => {
    const { Store } = await import("../app/store/store");
    const { getSnapshot } = await import("mobx-state-tree");
    const reloaded = Store.create({ productOverview: {} });
    reloaded.import({
      ...emptyProject,
      description: "A leftover seed. Must not become project state.",
    });
    const snapshot = getSnapshot(reloaded) as Record<string, unknown>;
    assert.equal("description" in snapshot, false);
  });
});
