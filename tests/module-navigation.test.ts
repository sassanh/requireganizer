import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { agentToolDescriptions, callAgentTool } from "../app/ai-agent/agent-access";
import { Store } from "../app/store";

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

  it("reads another module's items without opening it", async () => {
    const store = Store.create({});
    const other = Store.create({});
    other.writeItems([
      { type: "add", stage: "module-overview", kind: "purpose", content: { text: "Owners get a trusted spec." }, references: [], dependencies: [] },
    ]);
    const asked: string[] = [];
    const open = {
      moduleName: "Accounts",
      readModule: (name: string) => {
        asked.push(name);
        return other;
      },
      switchModule: () => {
        throw new Error("get_items must not open a module.");
      },
    };

    const read = JSON.parse(await callAgentTool(store, "get_items", { stage: "module-overview", module: "Checkout" }, open)) as {
      codesVersion: string;
      items: { code: string; id: string; text: string }[];
    };

    assert.deepEqual(asked, ["Checkout"]);
    assert.equal(read.codesVersion, other.codesVersion);
    assert.deepEqual(read.items.map(({ code, id, text }) => ({ code, id, text })), [
      { code: "PUR", id: other.itemsOf("module-overview")[0]!.id, text: "Owners get a trusted spec." },
    ]);
    // Naming the open module reads the open module.
    const own = JSON.parse(await callAgentTool(store, "get_items", { stage: "module-overview", module: "Accounts" }, open)) as { items: unknown[] };
    assert.deepEqual(own.items, []);
    assert.deepEqual(asked, ["Checkout"]);
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
});
