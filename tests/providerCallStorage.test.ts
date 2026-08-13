import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeProviderCalls } from "../app/lib/providerCallStorage";
import type { ProviderCallRecord } from "../app/lib/types";

function call(id: string, startedAt: string): ProviderCallRecord {
  return {
    id,
    operation: "generate requirement",
    attempt: 1,
    promptVersion: "2026-08-12.1",
    protocolVersion: 4,
    startedAt,
    durationMs: 100,
    provider: "provider",
    model: "model",
    outcome: "success",
    toolCallCount: 1,
  };
}

describe("provider call persistence", () => {
  it("merges hydrated and newly recorded calls without duplicates", () => {
    const stored = [call("old", "2026-08-12T08:00:00.000Z")];
    const current = [
      call("old", "2026-08-12T08:00:00.000Z"),
      call("new", "2026-08-12T09:00:00.000Z"),
    ];

    assert.deepEqual(
      mergeProviderCalls(stored, current, 100).map(({ id }) => id),
      ["old", "new"],
    );
  });

  it("keeps only the newest bounded calls", () => {
    const calls = [
      call("first", "2026-08-12T08:00:00.000Z"),
      call("second", "2026-08-12T09:00:00.000Z"),
      call("third", "2026-08-12T10:00:00.000Z"),
    ];

    assert.deepEqual(
      mergeProviderCalls(calls, [], 2).map(({ id }) => id),
      ["second", "third"],
    );
  });
});
