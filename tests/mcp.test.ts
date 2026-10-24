import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

import { environmentAiSettings } from "../server/aiEnvironment";
import { FilePersistenceAdapter } from "../server/fileAdapter";
import { serveMcp } from "../server/mcp";
import { stateDirectoryFor } from "../server/stateDirectory";

const root = mkdtempSync(join(tmpdir(), "requireganizer-mcp-"));
const projectFile = join(root, "requireganizer.json");
let previousStateHome: string | undefined;
before(() => {
  previousStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = join(root, "state");
});
after(() => {
  if (previousStateHome == null) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = previousStateHome;
  rmSync(root, { recursive: true, force: true });
});

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as { type: string; text?: string }[]).map((part) => part.text ?? "").join("");
}

describe("MCP server", () => {
  it("serves the project's agent tools to an MCP client and tells it when they change", async () => {
    await new FilePersistenceAdapter({
      projectFile,
      stateDirectory: stateDirectoryFor(projectFile),
    }).projects.saveIndex([
      { id: "project-a", name: "Plant Pal", description: "", updatedAt: "2026-10-24T00:00:00.000Z" },
    ]);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const service = await serveMcp({
      projectFile,
      aiSettings: environmentAiSettings({ AI_API_KEY: "test-key" }),
      serveInterface: (_request, response) => response.end("interface"),
      version: "test",
      transport: serverTransport,
    });
    const client = new Client({ name: "test-agent", version: "1" });
    let listChanges = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      listChanges += 1;
    });
    try {
      await client.connect(clientTransport);
      assert.match(client.getInstructions() ?? "", /approves it at http:\/\/127\.0\.0\.1:\d+\//);

      const { tools } = await client.listTools();
      const names = tools.map(({ name }) => name);
      assert.ok(names.includes("get_workflow_state"));
      assert.ok(names.includes("submit_product_overview"));

      const rejected = await client.callTool({
        name: "submit_product_overview",
        arguments: { name: "Plant Pal", purpose: "Keep plants alive.", primaryFeatures: [], targetUsers: [] },
      });
      assert.equal(rejected.isError, true);
      assert.ok(textOf(rejected).length > 0);

      const applied = await client.callTool({
        name: "submit_product_overview",
        arguments: {
          name: "Plant Pal",
          purpose: "Keep plants alive.",
          primaryFeatures: ["Track watering schedules"],
          targetUsers: ["Busy plant owners"],
        },
      });
      assert.equal(applied.isError, undefined);
      assert.match(textOf(applied), /^Applied to Product Overview\./);

      // The overview's submit tool now names the items it holds.
      for (let attempt = 0; attempt < 40 && listChanges === 0; attempt += 1) await delay(50);
      assert.equal(listChanges, 1);
      const overview = JSON.parse(
        textOf(await client.callTool({ name: "get_stage_artifacts", arguments: { stage: "product-overview" } })),
      ) as { productOverview: { name: string } };
      assert.equal(overview.productOverview.name, "Plant Pal");
    } finally {
      await client.close();
      await service.close();
    }
  });
});
