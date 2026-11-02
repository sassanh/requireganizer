import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { agentToolDescriptions, callAgentTool, type AgentToolDescription } from "../app/ai-agent/agent-access";
import { type ModuleEntry, type ModuleRegistry, visibleModuleNamed } from "../app/lib/moduleSchema";
import { ProjectHost } from "../app/project-host";
import type { ProjectSession, ProjectSessionSnapshot } from "../app/project-session";
import { Store } from "../app/store";

function moduleEntry(
  id: string,
  name: string,
  archivedAt: string | null = null,
): ModuleEntry {
  return { id, name, archivedAt, openStep: "module-overview", snapshot: {} };
}

const modules: ModuleEntry[] = [
  moduleEntry("accounts", "Accounts"),
  moduleEntry("checkout", "Checkout"),
  moduleEntry("old", "Old", "2026-01-01"),
];

function hostFor(registry: ModuleRegistry): ProjectHost {
  const snapshot: ProjectSessionSnapshot = {
    status: "ready",
    activeProject: { id: "project", name: "Project" },
    persistenceError: null,
    outsideChange: null,
    registry,
    store: Store.create({}),
  };
  const session = {
    persistence: { traits: { singleProject: false, name: "test storage" } },
    openOnlyProject: async () => {},
    getSnapshot: () => snapshot,
  } as unknown as ProjectSession;
  return new ProjectHost(session);
}

async function listedToolNames(registry: ModuleRegistry): Promise<string[]> {
  const host = hostFor(registry);
  const api = (host as unknown as {
    api: { listAgentTools: () => Promise<AgentToolDescription[]> };
  }).api;
  return (await api.listAgentTools()).map(({ name }) => name);
}

describe("module navigation over MCP", () => {
  it("lists switch_module only when the project has modules", () => {
    assert.equal(
      agentToolDescriptions({}).some(({ name }) => name === "switch_module"),
      false,
    );
    assert.equal(
      agentToolDescriptions({ moduleName: "Accounts", switchModule: () => "Accounts" }).some(
        ({ name }) => name === "switch_module",
      ),
      true,
    );
  });

  it("lists switch_module only when another visible module can be opened", async () => {
    const disabled = await listedToolNames({
      modulesEnabled: false,
      activeModuleId: "accounts",
      modules: [moduleEntry("accounts", "Accounts")],
    });
    assert.equal(disabled.includes("switch_module"), false);
    assert.equal(disabled.includes("create_module"), false);

    const single = await listedToolNames({
      modulesEnabled: true,
      activeModuleId: "accounts",
      modules: [moduleEntry("accounts", "Accounts")],
    });
    assert.equal(single.includes("switch_module"), false);
    assert.equal(single.includes("create_module"), true);

    const archivedOnly = await listedToolNames({
      modulesEnabled: true,
      activeModuleId: "accounts",
      modules: [
        moduleEntry("accounts", "Accounts"),
        moduleEntry("old", "Old", "2026-01-01"),
      ],
    });
    assert.equal(archivedOnly.includes("switch_module"), false);

    const multiple = await listedToolNames({
      modulesEnabled: true,
      activeModuleId: "accounts",
      modules: [moduleEntry("accounts", "Accounts"), moduleEntry("checkout", "Checkout")],
    });
    assert.equal(multiple.includes("switch_module"), true);
  });

  it("opens the module the agent names and reports the name the page shows", async () => {
    const store = Store.create({});
    const asked: string[] = [];

    const reply = await callAgentTool(
      store,
      "switch_module",
      { name: "checkout" },
      {
        moduleName: "Accounts",
        switchModule: (name) => {
          asked.push(name);
          return "Checkout";
        },
      },
    );

    assert.deepEqual(asked, ["checkout"]);
    assert.equal(
      reply,
      "Opened “Checkout”. Every tool now works on it; call get_workflow_state before working on it.",
    );
  });

  it("says when the named module is already open", async () => {
    const store = Store.create({});

    const reply = await callAgentTool(
      store,
      "switch_module",
      { name: "Accounts" },
      { moduleName: "Accounts", switchModule: () => "Accounts" },
    );

    assert.equal(reply, "“Accounts” is already open.");
  });

  it("is unavailable when the project has no modules", async () => {
    await assert.rejects(
      callAgentTool(Store.create({}), "switch_module", { name: "Accounts" }),
      /No tool named switch_module is available now\./,
    );
  });

  it("finds a visible module the way name uniqueness compares names", () => {
    assert.equal(visibleModuleNamed({ modules }, "  checkout ")?.id, "checkout");
    assert.equal(visibleModuleNamed({ modules }, "OLD"), null);
    assert.equal(visibleModuleNamed({ modules }, "Missing"), null);
  });
});
