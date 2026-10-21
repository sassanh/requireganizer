import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertModuleSnapshotSchema,
  MODULE_SCHEMA_VERSION,
} from "../app/lib/projectSchema";
import { itemSetRevision } from "../app/store/review";

const emptyProject = {
  schemaVersion: MODULE_SCHEMA_VERSION,
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
};

describe("module snapshot import", () => {
  it("accepts the current module schema and rejects obsolete data clearly", () => {
    assert.doesNotThrow(() => assertModuleSnapshotSchema(emptyProject));
    assert.throws(
      () => assertModuleSnapshotSchema({ ...emptyProject, schemaVersion: 1 }),
      /obsolete module schema 1.*module schema 5, or 3 migrated on load/,
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

  it("does not turn an unapproved revision into an approved one", async () => {
    const { Store } = await import("../app/store/store");
    const reloaded = Store.create({ productOverview: {} }) as unknown as {
      import(value: unknown): void;
      approvalOf(id: string): string | null;
    };
    const emptyRevisionId = itemSetRevision([]);
    reloaded.import({
      ...emptyProject,
      boundaryDesign: {
        id: "boundary",
        revisionId: "boundary-r1",
        revision: 1,
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
    assert.equal(reloaded.approvalOf("boundary"), "draft");
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
