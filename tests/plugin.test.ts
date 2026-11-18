import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8")) as Record<string, unknown>;
}

const packageJson = json("package.json") as { name: string; version: string };
const plugin = json(".claude-plugin/plugin.json") as {
  name: string;
  version: string;
  mcpServers: Record<string, { command: string; args: string[] }>;
};
const marketplace = json(".claude-plugin/marketplace.json") as {
  name: string;
  plugins: { name: string; source: string }[];
};

describe("Claude Code plugin", () => {
  it("runs the server of its own version, so a plugin version always means one server", () => {
    assert.equal(plugin.name, packageJson.name);
    assert.equal(plugin.version, packageJson.version);
    const server = plugin.mcpServers.requireganizer;
    assert.ok(server != null);
    assert.equal(server.command, "npx");
    assert.deepEqual(server.args, ["-y", `${packageJson.name}@${packageJson.version}`, "mcp"]);
  });

  it("is listed by the repository's marketplace from the repository itself", () => {
    assert.deepEqual(marketplace.plugins, [{ name: plugin.name, source: "./" }]);
  });
});
