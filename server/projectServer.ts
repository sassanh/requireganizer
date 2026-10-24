import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { type AddressInfo, connect } from "node:net";
import type { Duplex } from "node:stream";

import type { AiSettingsSource } from "ai-agent/settings";
import { ProjectHost } from "project-host";
import { ProjectSession } from "project-session";

import { FilePersistenceAdapter } from "./fileAdapter";
import { type ProjectSocket, projectSocket, tokenCookie } from "./projectSocket";
import { ownHosts } from "./requestTarget";
import {
  claimProject,
  type ProjectClaim,
  releaseUnreachableClaim,
  rememberedPort,
  rememberPort,
  serverToken,
  stateDirectoryFor,
} from "./stateDirectory";

/** The port a project is first served on, unless it is taken. */
export const DEFAULT_PORT = 4519;

export interface ProjectServerOptions {
  projectFile: string;
  /** The settings the installed AI runtime reads; checked here only to warn. */
  aiSettings: AiSettingsSource;
  /**
   * The port to listen on. Without it, the port the project was last served
   * on, else the default; the first free one from there.
   */
  port?: number;
  /** Answers every request that is not the project link: the interface. */
  serveInterface: (request: IncomingMessage, response: ServerResponse) => void;
  /** Takes the upgrade requests the project link does not, such as hot reload. */
  forwardUpgrade?: (request: IncomingMessage, socket: Duplex, head: Buffer) => void;
}

export interface ProjectServer {
  url: string;
  /** The project host, for a client in the same process. */
  host: ProjectHost;
  /** Problems with the setup a person should fix, such as a missing API key. */
  warnings: string[];
  /** Issue every pending write, synchronously. */
  flush(): void;
  /** Issue every pending write, then stop serving. */
  close(): Promise<void>;
}

/**
 * End the process with the server: a terminal signal stops it cleanly, and
 * an error nothing caught still issues the pending writes before exiting.
 */
export function endProcessWith(server: ProjectServer): void {
  const stop = () => {
    void server.close().then(() => process.exit(0));
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(signal, stop);
  process.once("uncaughtException", (error) => {
    server.flush();
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exit(1);
  });
}

const PORT_ATTEMPTS = 20;

function listen(
  server: ReturnType<typeof createServer>,
  port: number,
  attempts: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      if (error.code === "EADDRINUSE" && attempts > 1) {
        resolve(listen(server, port + 1, attempts - 1));
      } else {
        reject(error);
      }
    };
    const onListening = () => {
      server.off("error", onError);
      // The bound port, which differs from the requested one when that is 0.
      resolve((server.address() as AddressInfo).port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Serving a project, or where another process already serves it: its URL,
 * or null while that server is still starting.
 */
export type ProjectServerStart = { serving: ProjectServer } | { heldBy: { url: string | null } };

/**
 * One project, served from its file: the project host with the file adapter,
 * the link its pages connect to, and the interface. The host is the only
 * writer of the project while the server runs, so a project another process
 * serves is not served again.
 */
export async function startProjectServer(options: ProjectServerOptions): Promise<ProjectServerStart> {
  const stateDirectory = stateDirectoryFor(options.projectFile);
  let claimed = claimProject(stateDirectory);
  if ("heldBy" in claimed && claimed.heldBy.url != null) {
    // A holder that is gone or stopping gives its claim up.
    await releaseUnreachableClaim(stateDirectory, answers);
    claimed = claimProject(stateDirectory);
  }
  if (!("claim" in claimed)) return claimed;
  const { claim } = claimed;
  try {
    return { serving: await serveClaimed(options, stateDirectory, claim) };
  } catch (error) {
    claim.release();
    throw error;
  }
}

const ANSWER_TIMEOUT_MS = 1_000;

/** Whether a server listens at `url`. A server that does not answer in time is taken to be there. */
function answers(url: string): Promise<boolean> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve) => {
    const socket = connect({ host: hostname, port: Number(port) });
    const settle = (listening: boolean) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(ANSWER_TIMEOUT_MS, () => settle(true));
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
  });
}

async function serveClaimed(
  options: ProjectServerOptions,
  stateDirectory: string,
  claim: ProjectClaim,
): Promise<ProjectServer> {
  const adapter = new FilePersistenceAdapter({ projectFile: options.projectFile, stateDirectory });
  const warnings: string[] = [];
  try {
    adapter.readProjectFile();
  } catch (error) {
    // The interface explains it too, and opens the project once it is fixed.
    warnings.push(error instanceof Error ? error.message : String(error));
  }
  if (options.aiSettings.read().apiKey.length === 0) {
    warnings.push("AI_API_KEY is not set, so AI actions fail until you set it and restart the server.");
  }

  const session = new ProjectSession(adapter);
  const host = new ProjectHost(session);
  session.start();

  const token = serverToken(stateDirectory);
  const preferredPort = options.port ?? rememberedPort(stateDirectory) ?? DEFAULT_PORT;
  let port = preferredPort;
  let projectLink: ProjectSocket | null = null;
  const server = createServer((request, response) => {
    // A page under any other name, such as one rebound to this machine,
    // gets neither the interface nor its token.
    if (!ownHosts(port).has(request.headers.host ?? "")) {
      response
        .writeHead(403, { "content-type": "text/plain; charset=utf-8" })
        .end(`Open http://127.0.0.1:${port}/ instead.`);
      return;
    }
    response.setHeader("set-cookie", tokenCookie(port, token));
    options.serveInterface(request, response);
  });
  server.on("upgrade", (request, socket, head) => {
    if (projectLink?.upgrade(request, socket, head)) return;
    if (options.forwardUpgrade != null) options.forwardUpgrade(request, socket, head);
    else socket.destroy();
  });
  try {
    port = await listen(server, preferredPort, options.port == null ? PORT_ATTEMPTS : 1);
  } catch (error) {
    session.dispose();
    throw error;
  }
  rememberPort(stateDirectory, port);
  projectLink = projectSocket({ host, port, token });
  const url = `http://127.0.0.1:${port}/`;
  claim.announce(url);

  return {
    url,
    host,
    warnings,
    flush: () => session.flush(),
    close: () => {
      session.flush();
      session.dispose();
      return new Promise((resolve) => {
        server.close(() => {
          claim.release();
          resolve();
        });
        // Upgraded connections are no longer the HTTP server's to close.
        projectLink?.close();
        server.closeAllConnections();
      });
    },
  };
}
