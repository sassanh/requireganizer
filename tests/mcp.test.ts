import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";

import { type Context, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { type Notification, ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

import { installGateway } from "../app/ai-agent/gateway";
import { configureAiSettings } from "../app/ai-agent/settings";
import { ProjectClient } from "../app/project-client";
import { environmentAiSettings } from "../server/aiEnvironment";
import { FilePersistenceAdapter } from "../server/fileAdapter";
import { serveMcp } from "../server/mcp";
import { projectLink } from "../server/projectLink";
import { stateDirectoryFor } from "../server/stateDirectory";
import { assistantMessage, scriptedStreamFn } from "./support/scriptedStream";

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

/** The ids of the units the reviewer model was asked about. */
function unitsUnderReview(context: Context): string[] {
  const prompt = context.messages.find((message) => message.role === "user")!;
  const text = typeof prompt.content === "string"
    ? prompt.content
    : prompt.content.map((part) => (part.type === "text" ? part.text : "")).join("");
  return (JSON.parse(text) as { units: { id: string }[] }).units.map(({ id }) => id);
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as { type: string; text?: string }[]).map((part) => part.text ?? "").join("");
}

describe("MCP server", () => {
  it("serves the project's agent tools to an MCP client and tells it when they change", async () => {
    const options = {
      projectFile,
      aiSettings: environmentAiSettings({ AI_API_KEY: "test-key" }),
      serveInterface: (_request: unknown, response: { end(body: string): void }) => response.end("interface"),
    };
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const service = await serveMcp({ ...options, version: "test", transport: serverTransport });
    const client = new Client({ name: "test-agent", version: "1" });
    let listChanges = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      listChanges += 1;
    });
    const listChanged = async (count: number) => {
      for (let attempt = 0; attempt < 40 && listChanges < count; attempt += 1) await delay(50);
      assert.equal(listChanges, count);
    };
    const toolNames = async () => (await client.listTools()).tools.map(({ name }) => name);
    // The person's page, served by the MCP process.
    const page = projectLink(options);
    const pageClient = new ProjectClient(page.connect);
    const closePage = pageClient.open();
    try {
      await client.connect(clientTransport);
      assert.match(client.getInstructions() ?? "", /approves it at http:\/\/127\.0\.0\.1:\d+\//);

      // A repository with no project yet: the agent can still ask why nothing else is listed.
      assert.deepEqual(await toolNames(), ["get_workflow_state", "get_stage_artifacts", "get_input_changes", "get_scaffold_files"]);
      const noProject = await client.callTool({ name: "get_workflow_state", arguments: {} });
      assert.equal(noProject.isError, true);
      assert.match(textOf(noProject), /holds no project yet\. Ask the person to create it in Requireganizer/);

      // The person creates the project, as the page does.
      await pageClient.persistence.projects.saveIndex([
        { id: "project-a", name: "Plant Pal", description: "", updatedAt: "2026-10-24T00:00:00.000Z" },
      ]);
      await pageClient.selectProject("project-a", "Plant Pal");
      await listChanged(1);
      assert.ok((await toolNames()).includes("submit_product_overview"));

      const rejected = await client.callTool({
        name: "submit_product_overview",
        arguments: { purpose: "Keep plants alive.", primaryFeatures: [], targetUsers: [] },
      });
      assert.equal(rejected.isError, true);
      assert.ok(textOf(rejected).length > 0);

      const applied = await client.callTool({
        name: "submit_product_overview",
        arguments: {
          purpose: "Keep plants alive.",
          primaryFeatures: ["Track watering schedules"],
          targetUsers: ["Busy plant owners"],
        },
      });
      assert.equal(applied.isError, undefined);
      assert.match(textOf(applied), /^Applied to Product Overview\./);

      // The overview's submit tool now names the items it holds.
      await listChanged(2);
      const overview = JSON.parse(
        textOf(await client.callTool({ name: "get_stage_artifacts", arguments: { stage: "product-overview" } })),
      ) as { productOverview: { purpose: string } };
      assert.equal(overview.productOverview.purpose, "Keep plants alive.");
    } finally {
      closePage();
      await page.close();
      await client.close();
      await service.close();
    }
  });

  it("tells an agent whose first listing failed when the tools become available", async () => {
    const heldFile = join(root, "held", "requireganizer.json");
    mkdirSync(dirname(heldFile));
    const claim = join(stateDirectoryFor(heldFile), "server.json");
    mkdirSync(dirname(claim), { recursive: true });
    // Another process, still running, claimed the project and has not started serving it.
    writeFileSync(claim, JSON.stringify({ pid: process.ppid, url: null }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const service = await serveMcp({
      projectFile: heldFile,
      aiSettings: environmentAiSettings({ AI_API_KEY: "test-key" }),
      serveInterface: (_request, response) => response.end("interface"),
      version: "test",
      transport: serverTransport,
      hostWaitMs: 200,
    });
    const client = new Client({ name: "test-agent", version: "1" });
    let listChanges = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      listChanges += 1;
    });
    try {
      await client.connect(clientTransport);
      await assert.rejects(client.listTools(), /has not started serving it|did not answer/);

      // The other process stops without serving, so this one serves the project.
      rmSync(claim);
      for (let attempt = 0; attempt < 60 && listChanges === 0; attempt += 1) await delay(50);
      assert.equal(listChanges, 1);
      assert.ok((await client.listTools()).tools.some(({ name }) => name === "get_workflow_state"));
    } finally {
      await client.close();
      await service.close();
    }
  });

  it("keeps a client that restarts its timeout on progress waiting through the review, then gives it the reviewer's rejections", async () => {
    const reviewedFile = join(root, "reviewed", "requireganizer.json");
    mkdirSync(dirname(reviewedFile));
    await new FilePersistenceAdapter({
      projectFile: reviewedFile,
      stateDirectory: stateDirectoryFor(reviewedFile),
    }).projects.saveIndex([
      { id: "project-b", name: "Plant Pal", description: "", updatedAt: "2026-10-24T00:00:00.000Z" },
    ]);
    const aiSettings = environmentAiSettings({ AI_API_KEY: "test-key", AI_REVIEWER_MODEL: "reviewer-model" });
    configureAiSettings(aiSettings);
    // Each reply takes longer than the client waits without progress.
    installGateway(scriptedStreamFn([
      (context) => assistantMessage([{
        type: "toolCall",
        id: "verdicts",
        name: "submit_verdicts",
        arguments: {
          verdicts: unitsUnderReview(context).map((id) =>
            id === "productOverview/purpose"
              ? { id, verdict: "reject", reason: "Name who is helped." }
              : { id, verdict: "approve", reason: "It holds." }),
        },
      }]),
      assistantMessage([{ type: "text", text: "Done." }]),
    ], { delayMs: 200 }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const service = await serveMcp({
      projectFile: reviewedFile,
      aiSettings,
      serveInterface: (_request, response) => response.end("interface"),
      version: "test",
      transport: serverTransport,
      progressIntervalMs: 50,
    });
    const client = new Client({ name: "test-agent", version: "1" });
    try {
      await client.connect(clientTransport);
      let progressReports = 0;
      const submitted = await client.callTool(
        {
          name: "submit_product_overview",
          arguments: {
            purpose: "Keep plants alive.",
            primaryFeatures: ["Track watering schedules"],
            targetUsers: ["Busy plant owners"],
          },
        },
        undefined,
        { timeout: 150, resetTimeoutOnProgress: true, onprogress: () => (progressReports += 1) },
      );
      assert.ok(progressReports > 0);
      assert.match(
        textOf(submitted),
        /^Applied to Product Overview\..*\nThe reviewer model rejected one item\..*\n- productOverview\/purpose: Name who is helped\.$/s,
      );
      const state = JSON.parse(textOf(await client.callTool({ name: "get_workflow_state", arguments: {} }))) as {
        stages: { stage: string; reviewerRejections: { unitId: string; reason: string }[] }[];
      };
      assert.deepEqual(
        state.stages.find(({ stage }) => stage === "product-overview")?.reviewerRejections,
        [{ unitId: "productOverview/purpose", reason: "Name who is helped." }],
      );

      // A review that fails is no pass.
      installGateway(() => {
        const stream = createAssistantMessageEventStream();
        const failed = assistantMessage([]);
        stream.push({ type: "error", reason: "error", error: { ...failed, stopReason: "error", errorMessage: "Rate limited." } });
        return stream;
      });
      const resubmitted = await client.callTool({
        name: "submit_product_overview",
        arguments: {
          purpose: "Help busy plant owners keep their houseplants alive.",
          primaryFeatures: ["Track watering schedules"],
          targetUsers: ["Busy plant owners"],
        },
      });
      assert.match(textOf(resubmitted), /\nThe reviewer model could not review 3 items\. Tell the person/);
      assert.doesNotMatch(textOf(resubmitted), /rejected/);
    } finally {
      await client.close();
      await service.close();
    }
  });

  it("announces each change request that waits for the agent, once per message of the person's", async () => {
    const channelFile = join(root, "channel", "requireganizer.json");
    mkdirSync(dirname(channelFile));
    const options = {
      projectFile: channelFile,
      aiSettings: environmentAiSettings({ AI_API_KEY: "test-key" }),
      serveInterface: (_request: unknown, response: { end(body: string): void }) => response.end("interface"),
    };
    const connectAgent = async () => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const service = await serveMcp({ ...options, version: "test", transport: serverTransport });
      const client = new Client({ name: "test-agent", version: "1" });
      const threadIds: string[] = [];
      client.fallbackNotificationHandler = async (notification: Notification) => {
        if (notification.method === "notifications/claude/channel") {
          threadIds.push((notification.params as { meta: { thread_id: string } }).meta.thread_id);
        }
      };
      await client.connect(clientTransport);
      return { service, client, threadIds };
    };
    const announced = async (threadIds: string[], count: number) => {
      for (let attempt = 0; attempt < 40 && threadIds.length < count; attempt += 1) await delay(50);
      // Long enough for an announcement that should not come to arrive.
      await delay(300);
      assert.equal(threadIds.length, count);
    };
    const first = await connectAgent();
    let second: Awaited<ReturnType<typeof connectAgent>> | null = null;
    const page = projectLink(options);
    const pageClient = new ProjectClient(page.connect);
    const closePage = pageClient.open();
    const store = () => pageClient.getSnapshot().store;
    try {
      await pageClient.persistence.projects.saveIndex([
        { id: "project-c", name: "Plant Pal", description: "", updatedAt: "2026-10-24T00:00:00.000Z" },
      ]);
      await pageClient.selectProject("project-c", "Plant Pal");
      await first.client.callTool({
        name: "submit_product_overview",
        arguments: {
          purpose: "Keep plants alive.",
          primaryFeatures: ["Track watering schedules"],
          targetUsers: ["Busy plant owners"],
        },
      });
      for (let attempt = 0; attempt < 40 && store().productOverview.targetUsers.length === 0; attempt += 1) {
        await delay(50);
      }

      // While Requireganizer's AI answers, nothing waits for the agent.
      const threadId = await store().requestChange(store().productOverview.targetUsers[0]!.id, "Say who they are.");
      await announced(first.threadIds, 0);

      // Handed to the agent, the request waits for it.
      await store().setThreadAnswerer("coding-agent");
      await announced(first.threadIds, 1);
      assert.equal(first.threadIds[0], threadId);

      // Its reply hands the turn back; the person's next message waits for it again.
      await first.client.callTool({ name: "reply_to_thread", arguments: { threadId, text: "Owners who travel?" } });
      await announced(first.threadIds, 1);
      await store().requestChange(store().productOverview.targetUsers[0]!.id, "Yes, those.");
      await announced(first.threadIds, 2);

      // An agent that connects later hears of the request already waiting.
      second = await connectAgent();
      await announced(second.threadIds, 1);
      assert.deepEqual(second.threadIds, [threadId]);
    } finally {
      closePage();
      await page.close();
      if (second != null) {
        await second.client.close();
        await second.service.close();
      }
      await first.client.close();
      await first.service.close();
    }
  });
});
