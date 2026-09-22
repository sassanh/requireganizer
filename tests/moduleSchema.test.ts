import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertModuleNameAvailable,
  buildProjectPayload,
  createEmptyRegistry,
  LEGACY_MODULE_ID,
  type ModuleEntry,
  moduleScopeId,
  normalizeModuleName,
  parseProjectPayload,
  pickActiveModule,
  siblingModuleEntries,
  visibleModules,
} from "../app/lib/moduleSchema";
import {
  MODULE_SCHEMA_VERSION,
  PROJECT_SCHEMA_VERSION,
} from "../app/lib/projectSchema";
import { WorkflowStage } from "../app/store/constants";

const flatSnapshot = {
  schemaVersion: MODULE_SCHEMA_VERSION,
  productOverview: {
    name: "Legacy",
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

function entry(
  id: string,
  name: string,
  archivedAt: string | null = null,
  snapshot: Record<string, unknown> = flatSnapshot,
): ModuleEntry {
  return { id, name, archivedAt, openStep: WorkflowStage.ProductOverview, snapshot };
}

describe("project payload parsing", () => {
  it("wraps a flat schema 3 project as the single hidden legacy module", () => {
    const payload = parseProjectPayload(flatSnapshot);
    assert.equal(payload.schemaVersion, PROJECT_SCHEMA_VERSION);
    assert.equal(payload.modulesEnabled, false);
    assert.equal(payload.activeModuleId, LEGACY_MODULE_ID);
    assert.equal(payload.modules.length, 1);
    assert.equal(payload.modules[0].archivedAt, null);
    assert.equal(payload.modules[0].snapshot, flatSnapshot);
  });

  it("reads a schema 4 payload as its registry", () => {
    const payload = parseProjectPayload({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      modulesEnabled: true,
      activeModuleId: "module-b",
      modules: [
        {
          id: "module-a",
          name: "Payments",
          archivedAt: null,
          openStep: WorkflowStage.Requirements,
          snapshot: flatSnapshot,
        },
        {
          id: "module-b",
          name: "Billing",
          archivedAt: null,
          openStep: WorkflowStage.ProductOverview,
          snapshot: flatSnapshot,
        },
      ],
    });
    assert.equal(payload.modulesEnabled, true);
    assert.equal(payload.activeModuleId, "module-b");
    assert.deepEqual(
      payload.modules.map((module) => module.name),
      ["Payments", "Billing"],
    );
    assert.equal(payload.modules[0].openStep, WorkflowStage.Requirements);
  });

  it("rejects duplicate module names case-insensitively", () => {
    assert.throws(
      () =>
        parseProjectPayload({
          schemaVersion: PROJECT_SCHEMA_VERSION,
          modulesEnabled: true,
          activeModuleId: "module-a",
          modules: [
            entry("module-a", "Billing"),
            entry("module-b", "  billing "),
          ],
        }),
      /already exists/,
    );
  });

  it("rejects a payload whose active module is archived", () => {
    assert.throws(
      () =>
        parseProjectPayload({
          schemaVersion: PROJECT_SCHEMA_VERSION,
          modulesEnabled: true,
          activeModuleId: "module-a",
          modules: [
            entry("module-a", "Keep", "2026-09-01T00:00:00.000Z"),
            entry("module-b", "Other"),
          ],
        }),
      /active module “Keep” is archived/i,
    );
  });

  it("names both accepted versions when a payload is obsolete", () => {
    assert.throws(
      () => parseProjectPayload({ schemaVersion: 2 }),
      /obsolete project schema 2.*schema 3.*or 4/,
    );
    assert.throws(
      () => parseProjectPayload({ notAProject: true }),
      /obsolete project schema undefined/,
    );
  });

  it("rejects a module snapshot on an obsolete module schema", () => {
    assert.throws(
      () =>
        parseProjectPayload({
          schemaVersion: PROJECT_SCHEMA_VERSION,
          modulesEnabled: false,
          activeModuleId: "module-a",
          modules: [
            entry("module-a", "One", null, { schemaVersion: 2 }),
          ],
        }),
      /obsolete module schema 2.*schema 3 only/,
    );
  });
});

describe("module names", () => {
  it("trims and collapses whitespace", () => {
    assert.equal(normalizeModuleName("  My   Module \n"), "My Module");
  });

  it("rejects empty, oversized, slash, and dot names", () => {
    assert.throws(() => normalizeModuleName("   "), /cannot be empty/);
    assert.throws(() => normalizeModuleName(42), /cannot be empty/);
    assert.throws(() => normalizeModuleName("x".repeat(61)), /60 characters/);
    assert.throws(() => normalizeModuleName("a/b"), /slashes/);
    assert.throws(() => normalizeModuleName("."), /cannot be "\."/);
    assert.throws(() => normalizeModuleName(" .. "), /"\.\."/);
  });

  it("guards uniqueness case-insensitively", () => {
    const modules = [entry("module-a", "Billing")];
    assert.doesNotThrow(() => assertModuleNameAvailable("Payments", modules));
    assert.throws(() => assertModuleNameAvailable("billing", modules), /already exists/);
    assert.throws(() => assertModuleNameAvailable("BILLING", modules), /already exists/);
    assert.throws(() => assertModuleNameAvailable("  billing ", modules), /already exists/);
  });

  it("treats uncollapsed whitespace as the same name on either side", () => {
    assert.throws(
      () => assertModuleNameAvailable("A  B", [entry("module-a", "A B")]),
      /already exists/,
    );
    assert.throws(
      () => assertModuleNameAvailable("A B", [entry("module-a", "A  B")]),
      /already exists/,
    );
    assert.doesNotThrow(
      () => assertModuleNameAvailable("A B", [entry("module-a", "A C")]),
    );
  });
});

describe("registry views", () => {
  it("hides archived modules from the visible list", () => {
    const registry = {
      modulesEnabled: true,
      activeModuleId: "module-a",
      modules: [entry("module-a", "Keep"), entry("module-b", "Gone", "2026-09-01T00:00:00.000Z")],
    };
    assert.deepEqual(
      visibleModules(registry).map((module) => module.id),
      ["module-a"],
    );
    assert.equal(pickActiveModule(registry).id, "module-a");
  });

  it("falls back to the first visible module when the active one is archived", () => {
    const registry = {
      modulesEnabled: true,
      activeModuleId: "module-b",
      modules: [entry("module-a", "Keep"), entry("module-b", "Gone", "2026-09-01T00:00:00.000Z")],
    };
    assert.equal(pickActiveModule(registry).id, "module-a");
  });

  it("refuses a registry with no modules at all", () => {
    assert.throws(
      () => pickActiveModule({ modulesEnabled: false, activeModuleId: LEGACY_MODULE_ID, modules: [] }),
      /no modules/,
    );
  });

  it("starts a fresh project as one hidden legacy module", () => {
    const registry = createEmptyRegistry();
    assert.equal(registry.modulesEnabled, false);
    assert.equal(registry.activeModuleId, LEGACY_MODULE_ID);
    assert.equal(registry.modules[0].id, LEGACY_MODULE_ID);
    assert.equal(registry.modules[0].archivedAt, null);
  });

  it("scopes side storage per module", () => {
    assert.equal(moduleScopeId("project-1", "module-2"), "project-1::module-2");
  });

  it("offers only visible non-active modules as reference targets", () => {
    const registry = {
      modulesEnabled: true,
      activeModuleId: "module-a",
      modules: [
        entry("module-a", "Active"),
        entry("module-b", "Visible"),
        entry("module-c", "Gone", "2026-09-01T00:00:00.000Z"),
      ],
    };
    assert.deepEqual(
      siblingModuleEntries(registry).map((module) => module.id),
      ["module-b"],
    );
  });
});

describe("payload building", () => {
  it("folds the live snapshot into the active entry only", () => {
    const liveSnapshot = {
      ...flatSnapshot,
      productOverview: { ...flatSnapshot.productOverview, name: "Live" },
    };
    const registry = {
      modulesEnabled: true,
      activeModuleId: "module-a",
      modules: [entry("module-a", "Keep"), entry("module-b", "Other")],
    };

    const payload = buildProjectPayload(registry, liveSnapshot);

    assert.equal(payload.schemaVersion, PROJECT_SCHEMA_VERSION);
    assert.equal(payload.modules[0].snapshot, liveSnapshot);
    assert.equal(payload.modules[1].snapshot, flatSnapshot);
    // The registry the provider holds is left untouched.
    assert.notEqual(registry.modules[0].snapshot, liveSnapshot);
  });
});
