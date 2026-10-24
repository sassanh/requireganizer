import { resolve } from "node:path";
import { parseArgs } from "node:util";

import next from "next";

import { installAiRuntime } from "ai-agent/runtime";

import { environmentAiSettings } from "./aiEnvironment";
import { endProcessWith, startProjectServer } from "./projectServer";

const DEFAULT_PORT = 3000;
/** Development serves a project kept out of the repository unless one is named. */
const DEFAULT_PROJECT_FILE = "local/requireganizer.json";

/**
 * Development: the Next dev server, with hot reload, built for a server host,
 * together with the project server, in one process and on one port.
 */
async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { port: { type: "string" } },
  });
  const port = values.port == null ? DEFAULT_PORT : Number(values.port);
  const projectFile = resolve(positionals[0] ?? DEFAULT_PROJECT_FILE);

  process.env.NEXT_PUBLIC_PROJECT_HOST = "server";
  const app = next({ dev: true, dir: process.cwd(), hostname: "127.0.0.1", port });
  await app.prepare();
  const handle = app.getRequestHandler();
  // Read after Next has loaded `.env.local`.
  const aiSettings = environmentAiSettings();
  installAiRuntime(aiSettings);
  const server = await startProjectServer({
    projectFile,
    aiSettings,
    port,
    nextFreePort: false,
    serveInterface: (request, response) => void handle(request, response),
    forwardUpgrade: app.getUpgradeHandler(),
  });
  process.stdout.write(`Serving ${projectFile}\n`);
  for (const warning of server.warnings) process.stdout.write(`Warning: ${warning}\n`);
  process.stdout.write(`Open ${server.url}\n`);
  endProcessWith(server);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
