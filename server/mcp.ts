// The low-level server: the tool list and its schemas come from the project
// host and change with the project, which the high-level one does not serve.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { onSnapshot } from "mobx-state-tree";

import type { AgentToolDescription } from "ai-agent/agent-access";
import { ConnectionLostError, ProjectClient } from "project-client";

import { projectLink } from "./projectLink";
import type { ProjectServerOptions } from "./projectServer";

/** How long a tool call waits for the project's host, such as while another process takes over. */
const HOST_WAIT_MS = 15_000;
/** How long the server waits for the host before answering the agent without the page's address. */
const ADDRESS_WAIT_MS = 5_000;
/** Changes to the project are gathered this long before the tool list is checked again. */
const TOOL_LIST_CHECK_DELAY_MS = 500;
/** How often a call still running, such as a submission under review, tells the client so. */
const PROGRESS_INTERVAL_MS = 10_000;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Settles once the client reaches its host; throws what stands in the way after `waitMs`. */
function reachHost(client: ProjectClient, waitMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = (): boolean => {
      const status = client.getConnectionStatus();
      if (status.state === "open") {
        resolve();
        return true;
      }
      if (status.state === "failed") {
        reject(new Error(status.message));
        return true;
      }
      return false;
    };
    if (check()) return;
    const stop = client.subscribe(() => {
      if (check()) finish();
    });
    const timer = setTimeout(() => {
      finish();
      const status = client.getConnectionStatus();
      reject(new Error("message" in status ? status.message : "The Requireganizer project server did not answer."));
    }, waitMs);
    const finish = () => {
      stop();
      clearTimeout(timer);
    };
  });
}

function instructionsFor(url: string | null): string {
  const where = url == null ? "in Requireganizer" : `at ${url}`;
  return `Requireganizer holds the spec the person approves for this project, from the product overview to test cases, each item traced to what it serves. Read it before building: get_workflow_state shows which stage can change now; get_stage_artifacts reads the work. Submit a stage's work with its submit tool; the person reviews and approves it ${where}, and no tool approves.`;
}

export interface McpService {
  /** Stop answering, and stop serving the project if this process serves it; pending writes are issued first. */
  close(): Promise<void>;
}

/**
 * Serve one project to a coding agent over MCP on `transport`, such as
 * standard input and output. The tools are the project host's agent tools;
 * this process serves the project itself while no other process does, and
 * takes over when the one that does stops.
 */
export async function serveMcp(
  options: Omit<ProjectServerOptions, "port"> & {
    version: string;
    transport: Transport;
    /** How often a call still running tells the client so; ten seconds unless given. */
    progressIntervalMs?: number;
    /** How long a request waits for the project's host; fifteen seconds unless given. */
    hostWaitMs?: number;
  },
): Promise<McpService> {
  const link = projectLink({
    ...options,
    onServing: (server) => {
      process.stderr.write(`Requireganizer is serving ${options.projectFile} at ${server.url}\n`);
      for (const warning of server.warnings) process.stderr.write(`Warning: ${warning}\n`);
    },
  });
  const client = new ProjectClient(link.connect);
  const disconnect = client.open();
  await reachHost(client, ADDRESS_WAIT_MS).catch((error: unknown) => {
    process.stderr.write(`${messageOf(error)}\n`);
  });

  const server = new Server(
    { name: "requireganizer", version: options.version },
    { capabilities: { tools: { listChanged: true } }, instructions: instructionsFor(link.url()) },
  );

  const hostWaitMs = options.hostWaitMs ?? HOST_WAIT_MS;
  // What the agent was last given: null before it asked, "" when its first listing failed.
  let listed: string | null = null;
  const list = async (): Promise<AgentToolDescription[]> => {
    try {
      await reachHost(client, hostWaitMs);
      const tools = await client.listAgentTools();
      listed = JSON.stringify(tools);
      return tools;
    } catch (error) {
      listed ??= "";
      throw error;
    }
  };
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await list() }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    // A client that restarts its timeout on progress waits out a review this way.
    const progressToken = request.params._meta?.progressToken;
    let progress = 0;
    const progressTimer = progressToken == null ? null : setInterval(() => {
      progress += 1;
      extra.sendNotification({ method: "notifications/progress", params: { progressToken, progress } }).catch(() => {});
    }, options.progressIntervalMs ?? PROGRESS_INTERVAL_MS);
    try {
      await reachHost(client, hostWaitMs);
      // The name the agent gave when it connected signs what it writes in threads.
      const agent = server.getClientVersion();
      const caller = { name: agent?.title ?? agent?.name ?? "The coding agent" };
      const text = await client.callAgentTool(request.params.name, request.params.arguments ?? {}, caller);
      return { content: [{ type: "text", text }] };
    } catch (error) {
      const text = error instanceof ConnectionLostError
        ? `The connection to Requireganizer ended before it answered, so the call may or may not have taken effect. Call get_workflow_state before calling ${request.params.name} again.`
        : messageOf(error);
      return { content: [{ type: "text", text }], isError: true };
    } finally {
      if (progressTimer != null) clearInterval(progressTimer);
    }
  });

  // The tools follow the project: a stage's submit tool appears once its
  // earlier stages are approved, and its schema names the current items.
  let checkTimer: ReturnType<typeof setTimeout> | null = null;
  const checkToolList = () => {
    if (checkTimer != null || listed == null) return;
    checkTimer = setTimeout(() => {
      checkTimer = null;
      const before = listed;
      void list().then(
        () => {
          if (listed !== before) server.sendToolListChanged().catch(() => {});
        },
        () => {},
      );
    }, TOOL_LIST_CHECK_DELAY_MS);
  };
  let shownStore = client.getSnapshot().store;
  let stopWatchingStore = onSnapshot(shownStore, checkToolList);
  const stopWatchingClient = client.subscribe(() => {
    const store = client.getSnapshot().store;
    if (store !== shownStore) {
      stopWatchingStore();
      shownStore = store;
      stopWatchingStore = onSnapshot(store, checkToolList);
    }
    checkToolList();
  });

  await server.connect(options.transport);
  return {
    close: async () => {
      if (checkTimer != null) clearTimeout(checkTimer);
      stopWatchingStore();
      stopWatchingClient();
      disconnect();
      // Called first: it issues the pending writes before anything is awaited.
      const linkClosed = link.close();
      await server.close();
      await linkClosed;
    },
  };
}
