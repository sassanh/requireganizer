import { createHash } from "node:crypto";
import { hostname } from "node:os";

// The low-level server: the tool list and its schemas come from the project
// host and change with the project, which the high-level one does not serve.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Request } from "@modelcontextprotocol/sdk/types.js";

import type { AgentsClient } from "../client";
import type { AgentToolDescription } from "../interface";
import { type AgentNotice, NAME_YOURSELF_TEXT, type Registration } from "../registry";

/**
 * A Claude Code channel event: a session started with the MCP server as a
 * channel receives it as if the person had written it, and other clients
 * ignore it.
 */
interface ChannelNotification {
  method: "notifications/claude/channel";
  params: AgentNotice & Record<string, unknown>;
}

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

/** Whether the host is reachable, as the client tells. */
export type McpConnectionStatus =
  | { state: "connecting" }
  | { state: "open" }
  | { state: "reconnecting"; message: string }
  | { state: "failed"; message: string };

/** The project's host as this process reaches it: a client of it, which connects again whenever its connection is lost. */
export interface McpProjectClient {
  readonly agents: AgentsClient;
  /** Connect; returns the disconnect. */
  open(): () => void;
  getConnectionStatus(): McpConnectionStatus;
  /** Hear of each change of the connection or of the project. */
  subscribe(listener: () => void): () => void;
  /** Whether a call failed because the connection ended before it was answered. */
  isConnectionLost(error: unknown): boolean;
}

/** Settles once the client reaches its host; throws what stands in the way after `waitMs`. */
function reachHost(client: McpProjectClient, waitMs: number): Promise<void> {
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

function instructionsFor(url: string | null, instructions: string): string {
  const where = url == null ? "" : ` The spec owner reads and signs the project at ${url}.`;
  return `${instructions}${where}`;
}

/**
 * What the coding tool this process serves tells of the coding agent: the
 * session it serves, hashed so the session's id is never kept, and the
 * tool, the computer and whether the tool takes messages into its session.
 */
function registrationOf(server: Server<Request, ChannelNotification>): Registration {
  const client = server.getClientVersion();
  const session = process.env.CLAUDE_CODE_SESSION_ID;
  return {
    session: session == null || session.length === 0 ? null : createHash("sha256").update(session).digest("hex"),
    details: {
      tool: client?.name ?? null,
      toolVersion: client?.version ?? null,
      host: hostname(),
      sessionless: session == null || session.length === 0,
      // Claude Code lets the project send a message into a session through its channels.
      reachable: client?.name === "claude-code",
    },
  };
}

export interface McpService {
  /** Stop answering, and stop serving the project if this process serves it; pending writes are issued first. */
  close(): Promise<void>;
}

/** The project's host as this process serves or reaches it, such as a server's project link. */
export interface McpHostLink {
  /** Where the person opens the project, once known. */
  url(): string | null;
  /** Stop serving the project if this process serves it. */
  close(): Promise<void>;
}

/**
 * Serve one project to a coding agent over MCP on `transport`, such as
 * standard input and output. The tools are the project host's agent tools,
 * reached through `link`.
 */
export async function serveMcp(options: {
  link: McpHostLink;
  client: McpProjectClient;
  version: string;
  transport: Transport;
  /** How often a call still running tells the client so; ten seconds unless given. */
  progressIntervalMs?: number;
  /** How long a call waits for the project's host; fifteen seconds unless given. */
  hostWaitMs?: number;
}): Promise<McpService> {
  const { link, client } = options;
  const disconnect = client.open();
  const instructions = await reachHost(client, ADDRESS_WAIT_MS)
    .then(() => client.agents.agentInstructions())
    .catch((error: unknown) => {
      process.stderr.write(`${messageOf(error)}\n`);
      return NAME_YOURSELF_TEXT;
    });

  const server = new Server<Request, ChannelNotification>(
    { name: "requireganizer", version: options.version },
    {
      capabilities: { tools: { listChanged: true }, experimental: { "claude/channel": {} } },
      instructions: instructionsFor(link.url(), instructions),
    },
  );

  const hostWaitMs = options.hostWaitMs ?? HOST_WAIT_MS;
  // What the agent was last given: null before it asked, "" when its first listing failed.
  let listed: string | null = null;
  const list = async (): Promise<AgentToolDescription[]> => {
    try {
      await reachHost(client, hostWaitMs);
      const tools = await client.agents.listAgentTools();
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
      const text = await client.agents.callAgentTool(request.params.name, request.params.arguments ?? {});
      return { content: [{ type: "text", text }] };
    } catch (error) {
      const text = client.isConnectionLost(error)
        ? `The connection to Requireganizer ended before it answered, so the call may or may not have taken effect. Call get_workflow_state before calling ${request.params.name} again.`
        : messageOf(error);
      return { content: [{ type: "text", text }], isError: true };
    } finally {
      if (progressTimer != null) clearInterval(progressTimer);
    }
  });

  // The tools follow the project: the module tools appear once it has modules.
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
  // The agent hears what is meant for its session as it happens; what comes before the client initialized waits for it.
  let initialized = false;
  const unheard: AgentNotice[] = [];
  const tell = (notice: AgentNotice) => {
    if (!initialized) {
      unheard.push(notice);
      return;
    }
    server.notification({ method: "notifications/claude/channel", params: { ...notice } }).catch(() => {});
  };
  const stopNotices = client.agents.subscribeNotices(tell);
  server.oninitialized = () => {
    // This process is one coding agent: it registers with each connection it makes, as its coding tool tells.
    client.agents.actAsCodingAgent(registrationOf(server), client.getConnectionStatus().state === "open");
    initialized = true;
    for (const notice of unheard.splice(0)) tell(notice);
  };

  const stopWatchingClient = client.subscribe(checkToolList);

  await server.connect(options.transport);
  return {
    close: async () => {
      if (checkTimer != null) clearTimeout(checkTimer);
      stopWatchingClient();
      stopNotices();
      disconnect();
      // Called first: it issues the pending writes before anything is awaited.
      const linkClosed = link.close();
      await server.close();
      await linkClosed;
    },
  };
}
