import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Check `dist/` as npm would ship it: pack it, install the tarball outside
 * this repository with no registry, and run the installed command's help.
 * Then start the MCP server the way the Claude Code plugin declares it,
 * with this package standing in for the version npx would fetch, from
 * another folder than the project's, and check it serves that project: a
 * tool listing and the page.
 */
const root = mkdtempSync(join(tmpdir(), "requireganizer-package-"));

function fail(message) {
  console.error(`Package check failed: ${message}`);
  rmSync(root, { recursive: true, force: true });
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) fail(`${command} ${args.join(" ")}\n${result.stdout}${result.stderr}`);
  return result.stdout;
}

const manifest = JSON.parse(readFileSync("dist/package.json", "utf8"));
if (manifest.dependencies != null) fail("dist/package.json names dependencies; the bundle must hold them.");

const [packed] = JSON.parse(run("npm", ["pack", resolve("dist"), "--pack-destination", root, "--json"]));
const install = join(root, "install");
mkdirSync(install);
run("npm", ["install", "--prefix", install, "--offline", "--no-audit", "--no-fund", join(root, packed.filename)]);
const command = join(install, "node_modules", ".bin", "requireganizer");

if (!run(command, ["--help"]).startsWith("Usage: requireganizer")) fail("--help printed no usage.");

const plugin = JSON.parse(readFileSync(".claude-plugin/plugin.json", "utf8"));
const declared = plugin.mcpServers?.requireganizer;
const [yes, fetched, ...args] = declared?.args ?? [];
if (declared?.command !== "npx" || yes !== "-y" || fetched !== `${manifest.name}@${manifest.version}`) {
  fail(`The plugin starts ${JSON.stringify(declared)}, not npx -y ${manifest.name}@${manifest.version}.`);
}
// As Claude Code fills the settings in, all left empty.
const filled = (value) => value.replace(/\$\{user_config\.\w+\}/g, "");
const project = realpathSync(mkdtempSync(join(root, "project-")));
const elsewhere = mkdtempSync(join(root, "elsewhere-"));
const server = spawn(command, args, {
  cwd: elsewhere,
  env: {
    ...process.env,
    ...Object.fromEntries(Object.entries(declared.env ?? {}).map(([name, value]) => [name, filled(value)])),
    CLAUDE_PROJECT_DIR: project,
    XDG_STATE_HOME: join(root, "state"),
  },
  stdio: ["pipe", "pipe", "pipe"],
});
let log = "";
server.stderr.on("data", (chunk) => {
  log += chunk;
  process.stderr.write(chunk);
});
const listed = await new Promise((settle) => {
  const timer = setTimeout(() => settle(null), 30_000);
  let output = "";
  server.stdout.on("data", (chunk) => {
    output += chunk;
    // Only whole lines: a message may arrive across several chunks.
    const lines = output.split("\n");
    output = lines.pop();
    for (const line of lines) {
      const message = line.trim() === "" ? null : JSON.parse(line);
      if (message?.id === 2) {
        clearTimeout(timer);
        settle(message.result?.tools?.map(({ name }) => name) ?? []);
      }
    }
  });
  const send = (message) => server.stdin.write(`${JSON.stringify(message)}\n`);
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "package-check", version: "1" } },
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
});
// The process serves the project, page included, while no other process does.
const served = /serving (\S+) at (http:\/\/\S+)/.exec(log);
const pageUrl = served?.[2];
const page = pageUrl == null ? null : await fetch(pageUrl).catch((error) => error);
server.stdin.end();
const exited = await new Promise((settle) => {
  if (server.exitCode != null) return settle(true);
  const timer = setTimeout(() => settle(false), 10_000);
  server.once("exit", () => {
    clearTimeout(timer);
    settle(true);
  });
});
if (!exited) server.kill();
if (listed == null) fail("requireganizer mcp did not answer tools/list.");
if (!listed.includes("get_workflow_state")) fail(`requireganizer mcp listed ${listed.join(", ") || "no tools"}.`);
if (pageUrl == null) fail("requireganizer mcp did not say where it serves the page.");
if (served[1] !== join(project, "requireganizer.json")) fail(`The plugin's server served ${served[1]}, not the project in ${project}.`);
if (!(page instanceof Response) || page.status !== 200 || !page.headers.get("content-type")?.includes("text/html")) {
  fail(`${pageUrl} answered ${page instanceof Response ? page.status : page}, not the page.`);
}
if (!exited) fail("requireganizer mcp did not exit when its input closed.");

rmSync(root, { recursive: true, force: true });
process.stdout.write(`${packed.filename}: ${(packed.size / 1024 / 1024).toFixed(1)} MB packed; installs, and its plugin serves the project over MCP and the page.\n`);
