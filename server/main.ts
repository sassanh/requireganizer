import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { installAiRuntime } from "ai-agent/runtime";

import { environmentAiSettings } from "./aiEnvironment";
import { resolveProjectFile } from "./projectFile";
import { endProcessWith, startProjectServer } from "./projectServer";
import { serveStaticFiles } from "./staticFiles";

const USAGE = `Usage: requireganizer [project-file] [options]

Serves one Requireganizer project from its file. Without a project file, it
uses the nearest requireganizer.json in this folder or above, or creates one
here.

Options:
  --port <number>      Port to listen on (default 4519, or the next free one)
  --env-file <path>    Read AI_API_KEY and the other settings from this file
  --no-open            Do not open the browser
  -h, --help           Show this help

Environment:
  AI_API_KEY           Key for the AI endpoint
  AI_BASE_URL          OpenAI-compatible Responses API (default OpenRouter)
  AI_MODEL             Model that writes
  AI_REVIEWER_MODEL    Model that reviews; unset for manual review only
`;

const DEFAULT_PORT = 4519;

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
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    process.exit(2);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (positionals.length > 1) {
    process.stderr.write(`Name one project file.\n\n${USAGE}`);
    process.exit(2);
  }
  const port = values.port == null ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write(`--port must be a number from 1 to 65535.\n`);
    process.exit(2);
  }
  if (values["env-file"] != null) process.loadEnvFile(values["env-file"]);

  const interfaceRoot = join(dirname(fileURLToPath(import.meta.url)), "ui");
  if (!existsSync(join(interfaceRoot, "index.html"))) {
    process.stderr.write(`The interface is missing from ${interfaceRoot}. Build it with pnpm run server:build.\n`);
    process.exit(1);
  }

  const projectFile = resolveProjectFile(positionals[0] ?? null, process.cwd());
  const aiSettings = environmentAiSettings();
  installAiRuntime(aiSettings);
  const server = await startProjectServer({
    projectFile,
    aiSettings,
    port,
    nextFreePort: values.port == null,
    serveInterface: (request, response) => serveStaticFiles(interfaceRoot, request, response),
  });
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
