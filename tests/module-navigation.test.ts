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
