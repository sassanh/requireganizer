import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { callAgentTool } from "../app/delegation/interface/tools";
import { Store } from "../app/store";

describe("module navigation over MCP", () => {
  it("reads another module's items without opening it", async () => {
    const store = Store.create({});
    const other = Store.create({});
    other.writeItems([
      { type: "add", stage: "module-overview", kind: "purpose", content: { text: "Owners get a trusted spec." }, references: [], dependencies: [] },
    ]);
    const asked: string[] = [];
    const open = {
      moduleName: "Accounts",
      otherModule: (name: string) => {
        asked.push(name);
        return {
          id: "checkout",
          name: "Checkout",
          store: other,
          change: () => {
            throw new Error("get_items must not change a module.");
          },
        };
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
});
