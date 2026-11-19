// The low-level server: the tool list and its schemas come from the project
// host and change with the project, which the high-level one does not serve.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Request } from "@modelcontextprotocol/sdk/types.js";
import { onSnapshot } from "mobx-state-tree";

import type { ClientConnection } from "connection";
import { ConnectionLostError, ProjectClient } from "project-client";

import type { AgentNotice } from "../desk";
import { channelNotice, type ChannelNotification } from "./channel";
import { replyRulesText } from "../interface/replyRules";
import { type AgentToolDescription, NAME_YOURSELF_TEXT } from "../interface/tools";

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

function instructionsFor(url: string | null, mustName: boolean): string {
  const where = url == null ? "in Requireganizer" : `at ${url}`;
  return `${mustName ? `${NAME_YOURSELF_TEXT} ` : ""}Requireganizer holds the spec the spec owner signs for this project, stage by stage, each item traced to what it builds on. Read it before building: get_workflow_state shows which stages are open; get_stage_rules gives the published rules of each kind of item a stage holds, and get_items reads a stage's items by code. Write, change and remove items with write_items; the spec owner signs them ${where}, and no tool signs. A channel event names the request it is about by its id, its thread_id, its stage, what it asks (kind: a change, or to write or to review the stage), and while the project has modules its module: pass that module to each tool that takes one, such as get_items, get_thread, reply_to_thread and write_items. Every request waits in its thread: read it with get_thread. For a request to write or to review a stage, read the rules of its kinds of item with get_stage_rules and the items with get_items. Answer a request with a reply in its thread, with reply_to_thread, or with write_items and its answers; a reply of yours to a request you have may give findings, each naming an item, a published rule of its kind that it breaks, and how. Your reply ends your having the request. When you cannot answer a request given to you, pass its id to report_cannot_answer. To point the spec owner to a set of items, coverages and impacts that need them, pass pointTo with write_items or reply_to_thread, with one text of at most 80 characters saying why. ${replyRulesText()}`;
}

export interface McpService {
  /** Stop answering, and stop serving the project if this process serves it; pending writes are issued first. */
  close(): Promise<void>;
}

/** The project's host as this process reaches it, such as a server's project link. */
export interface McpHostLink {
  connect(): ClientConnection;
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
  version: string;
  transport: Transport;
  /** How often a call still running tells the client so; ten seconds unless given. */
  progressIntervalMs?: number;
  /** How long a request waits for the project's host; fifteen seconds unless given. */
  hostWaitMs?: number;
}): Promise<McpService> {
  const { link } = options;
  const client = new ProjectClient(link.connect);
  // This process is one coding agent: it registers with each connection it makes.
  client.agents.actAsAgent();
  const disconnect = client.open();
  // A host that keeps agents asks this one to name itself before anything else.
  const mustName = await reachHost(client, ADDRESS_WAIT_MS)
    .then(() => client.agents.listAgentTools())
    .then((tools) => tools.some(({ name }) => name === "name_yourself"))
    .catch((error: unknown) => {
      process.stderr.write(`${messageOf(error)}\n`);
      return false;
    });

  const server = new Server<Request, ChannelNotification>(
    { name: "requireganizer", version: options.version },
    {
      capabilities: { tools: { listChanged: true }, experimental: { "claude/channel": {} } },
      instructions: instructionsFor(link.url(), mustName),
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
      // The name the agent gave when it connected signs what it writes in threads.
      const agent = server.getClientVersion();
      const caller = { name: agent?.title ?? agent?.name ?? "The coding agent" };
      const text = await client.agents.callAgentTool(request.params.name, request.params.arguments ?? {}, caller);
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
  // The agent hears of each request given to it, and of each one stopped, as it happens; one heard before the client initialized waits for it.
  let initialized = false;
  const unheard: AgentNotice[] = [];
  const tell = (notice: AgentNotice) => {
    if (!initialized) {
      unheard.push(notice);
      return;
    }
    server.notification({ method: "notifications/claude/channel", params: channelNotice(notice) }).catch(() => {});
  };
  const stopNotices = client.agents.subscribeNotices(tell);
  server.oninitialized = () => {
    initialized = true;
    for (const notice of unheard.splice(0)) tell(notice);
  };

  const onProjectChange = () => checkToolList();
  let shownStore = client.getSnapshot().store;
  let stopWatchingStore = onSnapshot(shownStore, onProjectChange);
  const stopWatchingClient = client.subscribe(() => {
    const store = client.getSnapshot().store;
    if (store !== shownStore) {
      stopWatchingStore();
      shownStore = store;
      stopWatchingStore = onSnapshot(store, onProjectChange);
    }
    onProjectChange();
  });

  await server.connect(options.transport);
  return {
    close: async () => {
      if (checkTimer != null) clearTimeout(checkTimer);
      stopWatchingStore();
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
