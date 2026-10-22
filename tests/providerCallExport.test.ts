import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  providerCallExportBaseName,
  providerCallToCurl,
  providerCallsToCsv,
} from "../app/lib/providerCallExport";
import type { ProviderCallRecord } from "../app/lib/types";

const call: ProviderCallRecord = {
  id: "call-1",
  operation: "generate, requirements",
  attempt: 1,
  promptVersion: "2026-08-12.1",
  protocolVersion: 4,
  startedAt: "2026-08-12T08:00:00.000Z",
  durationMs: 1250,
  provider: "provider",
  model: "model",
  authenticationMode: "anonymous",
  outcome: "success",
  toolCallCount: 1,
  toolName: "submit_requirements",
  usage: {
    inputTokens: 100,
    cachedInputTokens: 75,
    outputTokens: 25,
    totalTokens: 125,
  },
};

describe("provider call export", () => {
  it("exports a stable CSV header and escapes cells", () => {
    const csv = providerCallsToCsv([call]);

    assert.match(csv, /^id,operation,attempt,startedAt/);
    assert.match(csv, /call-1,"generate, requirements",1/);
    assert.match(csv, /,anonymous,success,/);
    assert.match(csv, /,100,75,,25,125,,,$/);
  });

  it("creates a filesystem-safe project filename", () => {
    assert.equal(
      providerCallExportBaseName("  My Project / Demo!  "),
      "my-project-demo-provider-calls",
    );
    assert.equal(providerCallExportBaseName("***"), "project-provider-calls");
  });

  it("renders a provider call as a runnable curl command", () => {
    assert.equal(
      providerCallToCurl(call),
      [
        'curl "${AI_BASE_URL:-https://opencode.ai/zen/v1}/responses" \\',
        '  -H "Authorization: Bearer ${AI_API_KEY:-${OPENCODE_API_KEY:-public}}" \\',
        '  -H "Content-Type: application/json" \\',
        `  --data-raw '{"model":"model","input":"<request input not recorded>","stream":true}'`,
      ].join("\n"),
    );
  });

  it("escapes shell quotes in the curl request body", () => {
    const curl = providerCallToCurl({ ...call, model: "model'quoted" });
    assert.ok(curl.includes(`"model":"model'\\''quoted"`));
  });
});
