import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { refreshGuidance, WorkflowStage } from "../app/store/constants";
import { hasGeneratedScaffoldIn, Store } from "../app/store/store";

function makeStore(primaryFeatureId: string) {
  return Store.create({
    productOverview: {
      name: "Plant Pal",
      primaryFeatures: [{ id: primaryFeatureId, content: "Track watering" }],
    },
  });
}

describe("module-mode copy", () => {
  it("keeps product labels with modules off and swaps them with modules on", () => {
    const store = makeStore("feat-1");
    assert.equal(store.stageLabel(WorkflowStage.ProductOverview), "Product Overview");
    assert.equal(store.rootSubjectLabel, "root product");

    store.setModuleContext({ moduleMode: true });
    assert.equal(store.stageLabel(WorkflowStage.ProductOverview), "Module Overview");
    assert.equal(store.stageLabel(WorkflowStage.Requirements), "Requirements");
    assert.equal(store.rootSubjectLabel, "root module");

    store.setModuleContext({ moduleMode: false });
    assert.equal(store.stageLabel(WorkflowStage.ProductOverview), "Product Overview");
  });

  it("labels refresh guidance with the live stage name", () => {
    assert.equal(
      refreshGuidance(WorkflowStage.Requirements),
      "Refresh Requirements",
    );
    assert.equal(
      refreshGuidance(WorkflowStage.ProductOverview, "Module Overview"),
      "Refresh Module Overview",
    );
  });
});

describe("cross-module display references", () => {
  it("resolves a sibling module's code and links into that module", () => {
    const active = makeStore("feat-a");
    const siblingStore = makeStore("feat-b");
    const siblingCode = siblingStore.getCode("feat-b");
    const siblingPath = siblingStore.getPath("feat-b");
    assert.ok(siblingCode != null);
    assert.ok(siblingPath != null);

    active.setSiblingModules([{ id: "module-b", store: siblingStore }]);

    assert.equal(active.getCode("feat-b"), siblingCode);
    assert.equal(
      active.getPath("feat-b"),
      `?module=module-b&${siblingPath.slice(1)}`,
    );
  });

  it("keeps own code authoritative and unknown ids unresolved", () => {
    const active = makeStore("feat-a");
    const siblingStore = makeStore("feat-b");
    active.setSiblingModules([{ id: "module-b", store: siblingStore }]);

    assert.equal(active.getPath("feat-a"), `?step=${WorkflowStage.ProductOverview}#${active.getCode("feat-a")}`);
    assert.equal(active.getCode("missing"), undefined);
    assert.equal(active.getPath("missing"), undefined);
  });
});

describe("generated-scaffold presence", () => {
  it("reports presence for a live store or a stored snapshot alike", () => {
    assert.equal(hasGeneratedScaffoldIn(null, 0), false);
    assert.equal(hasGeneratedScaffoldIn(null, 3), false);
    assert.equal(hasGeneratedScaffoldIn({ status: "approved" }, 0), false);
    assert.equal(hasGeneratedScaffoldIn({ status: "approved" }, 1), true);

    const store = makeStore("feat-1");
    assert.equal(
      hasGeneratedScaffoldIn(store.projectSetup, store.scaffoldFiles.length),
      store.hasGeneratedScaffold,
    );
  });
});
