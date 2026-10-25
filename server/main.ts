import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { installAiRuntime } from "ai-agent/runtime";

import packageJson from "../package.json";
import { environmentAiSettings } from "./aiEnvironment";
import { serveMcp } from "./mcp";
import { resolveProjectFile } from "./projectFile";
import { endProcessWith, startProjectServer } from "./projectServer";
import { serveStaticFiles } from "./staticFiles";

const USAGE = `Usage: requireganizer [project-file] [options]
       requireganizer mcp [project-file] [--env-file <path>]

Serves one Requireganizer project from its file. Without a project file, it
uses the nearest requireganizer.json in this folder or above, or creates one
here. When the project is already served, it opens that server instead.

mcp serves the project to a coding agent over standard input and output.

Options:
  --port <number>      Port to listen on (default: the project's last port,
                       else 4519, or the next free one)
  --env-file <path>    Read AI_API_KEY and the other settings from this file
  --no-open            Do not open the browser
  -h, --help           Show this help

Environment:
  AI_API_KEY           Key for the AI endpoint
  AI_BASE_URL          OpenAI-compatible Responses API (default OpenRouter)
  AI_MODEL             Model that writes
  AI_REVIEWER_MODEL    Model that reviews; unset for manual review only
`;

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}

function usageError(message: string): never {
  process.stderr.write(`${message}\n\n${USAGE}`);
  process.exit(2);
}

/** Answers page requests when the interface was not built, such as for a server an agent started. */
function missingInterface(interfaceRoot: string): (request: IncomingMessage, response: ServerResponse) => void {
  return (_request, response) => {
    response
      .writeHead(503, { "content-type": "text/plain; charset=utf-8" })
      .end(`The interface is missing from ${interfaceRoot}. Build it with pnpm run server:build.`);
  };
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        port: { type: "string" },
        "env-file": { type: "string" },
        "no-open": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    usageError(error instanceof Error ? error.message : String(error));
  }
  const { values } = parsed;
  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }
  const mcp = parsed.positionals[0] === "mcp";
  const positionals = mcp ? parsed.positionals.slice(1) : parsed.positionals;
  if (positionals.length > 1) usageError("Name one project file.");
  if (mcp && (values.port != null || values["no-open"] != null)) {
    usageError("mcp takes only a project file and --env-file.");
  }
  const port = values.port == null ? undefined : Number(values.port);
  if (port != null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    usageError("--port must be a number from 1 to 65535.");
  }
  if (values["env-file"] != null) process.loadEnvFile(values["env-file"]);

  const interfaceRoot = join(dirname(fileURLToPath(import.meta.url)), "ui");
  const interfaceBuilt = existsSync(join(interfaceRoot, "index.html"));
  const serveInterface = interfaceBuilt
    ? (request: IncomingMessage, response: ServerResponse) => serveStaticFiles(interfaceRoot, request, response)
    : missingInterface(interfaceRoot);
  // Claude Code names the project an MCP server it starts serves, which may
  // not be the folder it starts it in, such as for a plugin's server.
  const projectDirectory = mcp ? (process.env.CLAUDE_PROJECT_DIR ?? process.cwd()) : process.cwd();
  const projectFile = resolveProjectFile(positionals[0] ?? null, projectDirectory);
  const aiSettings = environmentAiSettings();
  installAiRuntime(aiSettings);

  if (mcp) {
    // Standard output carries the protocol; everything else goes to standard error.
    Object.assign(console, { log: console.error, info: console.error, debug: console.error });
    const service = await serveMcp({
      projectFile,
      aiSettings,
      serveInterface,
      version: packageJson.version,
      transport: new StdioServerTransport(),
    });
    // The agent ends the session by closing standard input.
    const stop = () => void service.close().then(() => process.exit(0));
    process.stdin.once("end", stop);
    process.stdin.once("close", stop);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(signal, stop);
    process.once("uncaughtException", (error) => {
      // Closing issues the pending writes first, synchronously.
      void service.close();
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exit(1);
    });
    return;
  }

  if (!interfaceBuilt) {
    process.stderr.write(`The interface is missing from ${interfaceRoot}. Build it with pnpm run server:build.\n`);
    process.exit(1);
  }
  const started = await startProjectServer({ projectFile, aiSettings, port, serveInterface });
  if ("heldBy" in started) {
    if (started.heldBy.url == null) {
      process.stderr.write("Another Requireganizer process is starting this project. Try again in a moment.\n");
      process.exit(1);
    }
    process.stdout.write(`Requireganizer is already serving ${projectFile}\nOpen ${started.heldBy.url}\n`);
    if (!values["no-open"]) openBrowser(started.heldBy.url);
    return;
  }
  const server = started.serving;
  process.stdout.write(`Requireganizer is serving ${projectFile}\n`);
  for (const warning of server.warnings) process.stdout.write(`Warning: ${warning}\n`);
  process.stdout.write(`Open ${server.url}\n`);
  if (!values["no-open"]) openBrowser(server.url);

  endProcessWith(server);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
