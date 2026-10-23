import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { installFakeWebEnvironment } from "./support/fakeWebEnvironment";
import {
  describePersistenceAdapterContract,
  providerCall,
  timelineData,
} from "./support/persistenceAdapterContract";
import { LEGACY_MODULE_ID } from "../app/lib/moduleSchema";
import { ProviderCallStorageError } from "../app/lib/providerCallStorage";
import type { ProviderCallRecord } from "../app/lib/types";
import { WebPersistenceAdapter } from "../app/persistence";

function createWebAdapter(): WebPersistenceAdapter {
  installFakeWebEnvironment();
  return new WebPersistenceAdapter();
}

describePersistenceAdapterContract(createWebAdapter);

describe("web persistence adapter timeline migration", () => {
  it("falls back to the legacy timeline key for the legacy module only", async () => {
    const { localStorage } = installFakeWebEnvironment();
    const adapter = new WebPersistenceAdapter();
    localStorage.setItem(
      `requireganizer:timeline:project-1`,
      JSON.stringify(timelineData("legacy")),
    );

    assert.deepEqual(
      await adapter.timelines.load("project-1", LEGACY_MODULE_ID),
      timelineData("legacy"),
    );
    assert.equal(await adapter.timelines.load("project-1", "module-a"), null);
  });
});

describe("web persistence adapter provider-call replacement", () => {
  it("keeps the previous calls when a replacement cannot be cloned", async () => {
    installFakeWebEnvironment();
    const adapter = new WebPersistenceAdapter();
    await adapter.providerCalls.replace("project-1", "module-a", [
      providerCall("call-a", "2026-10-22T09:00:00.000Z", "kept"),
    ]);
    const unclonable = {
      ...providerCall("call-b", "2026-10-22T10:00:00.000Z"),
      callback: () => undefined,
    } as unknown as ProviderCallRecord;

    await assert.rejects(
      adapter.providerCalls.replace("project-1", "module-a", [unclonable]),
      ProviderCallStorageError,
    );
    assert.deepEqual(
      (await adapter.providerCalls.load("project-1", "module-a")).map(
        (call) => call.operation,
      ),
      ["kept"],
    );
  });
});
