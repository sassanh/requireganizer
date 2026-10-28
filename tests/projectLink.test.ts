import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import type { LinkClosed } from "../app/connection";
import { ProjectClient } from "../app/project-client";
import { environmentAiSettings } from "../server/aiEnvironment";
import { connectAsOwnPage, projectLink, type ProjectLink } from "../server/projectLink";

const root = mkdtempSync(join(tmpdir(), "requireganizer-link-"));
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

/** Each link names itself in `serving` whenever it starts serving the project. */
const serving: string[] = [];

function link(name: string): ProjectLink {
  return projectLink({
    projectFile,
    aiSettings: environmentAiSettings({ AI_API_KEY: "test-key" }),
    serveInterface: (_request, response) => response.end("interface"),
    onServing: () => serving.push(name),
  });
}

function connected(projectLinkToUse: ProjectLink): { client: ProjectClient; disconnect: () => void } {
  const client = new ProjectClient(projectLinkToUse.connect);
  return { client, disconnect: client.open() };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const OVERVIEW = {
  name: "Plant Pal",
  purpose: "Help people keep houseplants alive.",
  primaryFeatures: ["Track watering schedules"],
  targetUsers: ["Busy plant owners"],
};

describe("one host per project", () => {
  it("ends a link to a server that refuses it, for the client to try again, without ending the process", async () => {
    const reason = await new Promise<LinkClosed>((resolve) => {
      connectAsOwnPage("http://127.0.0.1:1/", "token").subscribe({ message: () => {}, closed: resolve });
    });
    assert.equal(reason.retry, true);
  });

  it("serves an outside agent's tools, and a remaining process takes over from a host that stops", async () => {
    const first = link("first");
    const second = link("second");
    const one = connected(first);
    const two = connected(second);
    try {
      // The project file holds no project yet.
      await assert.rejects(() => one.client.callAgentTool("get_workflow_state", {}, { name: "Test agent" }), /holds no project yet/);
      await one.client.persistence.projects.saveIndex([
        { id: "project-a", name: "Plant Pal", description: "", updatedAt: "2026-10-24T00:00:00.000Z" },
      ]);

      // The first process serves the project; the second reaches it over the socket.
      const tools = (await two.client.listAgentTools()).map(({ name }) => name);
      assert.ok(tools.includes("get_workflow_state"));
      assert.ok(tools.includes("submit_product_overview"));
      assert.ok(!tools.includes("communicate"));
      const url = first.url();
      assert.ok(url != null);
      assert.equal(second.url(), url);
      assert.deepEqual(serving, ["first"]);

      await assert.rejects(
        () => two.client.callAgentTool("submit_product_overview", { ...OVERVIEW, primaryFeatures: [] }, { name: "Test agent" }),
        (error: unknown) => error instanceof Error && error.message.length > 0,
      );
      assert.match(
        await two.client.callAgentTool("submit_product_overview", OVERVIEW, { name: "Test agent" }),
        /^Applied to Product Overview\./,
      );
      assert.equal(one.client.getSnapshot().store.productOverview.name, "Plant Pal");
      const state = JSON.parse(await two.client.callAgentTool("get_workflow_state", {}, { name: "Test agent" })) as {
        frontier: string;
      };
      assert.equal(state.frontier, "product-overview");

      // The host stops; the process still connected serves the project on the same port.
      one.disconnect();
      await first.close();
      const takenOver = () => serving.length === 2 && two.client.getConnectionStatus().state === "open";
      for (let attempt = 0; attempt < 100 && !takenOver(); attempt += 1) await delay(50);
      assert.deepEqual(serving, ["first", "second"]);
      assert.equal(second.url(), url);
      assert.equal(two.client.getSnapshot().store.productOverview.name, "Plant Pal");
      assert.ok((await two.client.listAgentTools()).length > 0);
    } finally {
      one.disconnect();
      two.disconnect();
      await first.close();
      await second.close();
    }
  });
});
