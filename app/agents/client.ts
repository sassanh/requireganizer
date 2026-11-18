import { UserFacingError } from "lib/errors";

import { type AgentNotice, type DeskView, RequestsConcernedError, type RequestState } from "./desk";
import type { AgentsHostApi, AgentsHostEvent } from "./host";
import type { AgentCaller, AgentToolDescription } from "./interface/tools";
import type { RunAgent } from "./internal/runAgents";
import type { AgentId } from "./roster";

/** How a client sends one of the Agents module's requests to its host. */
export type AgentsRequest = <Name extends keyof AgentsHostApi>(
  name: Name,
  ...args: Parameters<AgentsHostApi[Name]>
) => Promise<Awaited<ReturnType<AgentsHostApi[Name]>>>;

/** Asks the spec owner whether to stop the requests an action concerns; resolves to the keys to stop, or null to give the action up. */
export type Confirmer = (requests: readonly RequestState[], action: string) => Promise<string[] | null>;

/** What a store action of the spec owner's does, as a confirmation names it. */
const STORE_ACTION_NAMES: Partial<Record<string, string>> = {
  writeItems: "make the change",
  restoreSigned: "return to the signed version",
  resolveThread: "resolve the thread",
  replyAsSpecOwner: "send the message",
  requestChange: "send the message",
};

/** A store action as a confirmation names it. */
export function storeActionName(name: string): string {
  return STORE_ACTION_NAMES[name] ?? "carry it out";
}

/**
 * The Agents module as a client of a project host holds it: the agents and
 * waiting requests the host sends, the agent this client is when it is a
 * coding agent, and the confirmation the spec owner gives before an action
 * that concerns requests agents have. The project client sends its requests
 * and hands it the host's agents events.
 */
export class AgentsClient {
  private view: DeskView = { agents: [], requests: [] };
  private readonly noticeListeners = new Set<(notice: AgentNotice) => void>();
  /** For a client that is a coding agent: the agent it is, and the name it asks for again on each new connection. */
  private agent: { agentId: AgentId | null; name: string | null } | null = null;
  private confirmer: Confirmer | null = null;

  constructor(
    private readonly request: AgentsRequest,
    /** Tell the client's subscribers that the agents or the waiting requests changed. */
    private readonly changed: () => void,
  ) {}

  /** The agents and the waiting requests. */
  getView = (): DeskView => this.view;

  /** Take an agents event from the host. */
  receive(event: AgentsHostEvent): void {
    switch (event.type) {
      case "agents": {
        this.view = event.view;
        // The name a coding agent gave itself is the one it asks for again after a new connection.
        const agent = this.agent;
        if (agent?.agentId != null) {
          const self = event.view.agents.find(({ id }) => id === agent.agentId);
          if (self?.name != null) agent.name = self.name;
        }
        this.changed();
        return;
      }
      case "agent-notice":
        for (const listener of this.noticeListeners) listener(event.notice);
        return;
    }
  }

  /** A connection to the host opened: a coding agent is one connection, so each new one registers again, under the name it had. */
  connected(): void {
    const agent = this.agent;
    if (agent == null) return;
    this.request("registerAgent", agent.name).then(
      (registered) => {
        Object.assign(agent, registered);
        this.changed();
      },
      (error: unknown) => console.error("Could not register as an agent.", error),
    );
  }

  /** Connect as a coding agent: the host tells this client of each request given to it or stopped. */
  actAsAgent = (): void => {
    this.agent ??= { agentId: null, name: null };
  };

  /** Hear of each request given to this client's agent or stopped. */
  subscribeNotices = (listener: (notice: AgentNotice) => void): (() => void) => {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  };

  /** Let the page ask the spec owner to confirm stopping the requests an action concerns. */
  setConfirmer = (confirmer: Confirmer | null): void => {
    this.confirmer = confirmer;
  };

  /**
   * Carry out an action the host refuses while it concerns requests agents
   * have: ask the spec owner, then send it again with the requests they
   * confirmed stopping. Rejects when they give it up.
   */
  confirmed = async <Value>(action: string, send: (stopping?: string[]) => Promise<Value>): Promise<Value> => {
    try {
      return await send();
    } catch (error) {
      if (!(error instanceof RequestsConcernedError) || this.confirmer == null) throw error;
      const stopping = await this.confirmer(error.requests, action);
      if (stopping == null) throw new UserFacingError(`Gave up: ${action}.`);
      return send(stopping);
    }
  };

  /** The tools an agent can call on the open project now. */
  listAgentTools = (): Promise<AgentToolDescription[]> => this.request("listAgentTools");

  /** Run one of those tools for the agent this client is; resolves to its text result. */
  callAgentTool = (name: string, args: Record<string, unknown>, caller: AgentCaller): Promise<string> => this.request("callAgentTool", name, args, caller);

  nameCodingAgent = (agentId: AgentId, name: string): Promise<void> => this.request("nameCodingAgent", agentId, name);

  addRunAgent = (agent: Omit<RunAgent, "id">): Promise<void> => this.request("addRunAgent", agent);

  changeRunAgent = (agentId: AgentId, agent: Omit<RunAgent, "id">): Promise<void> => this.request("changeRunAgent", agentId, agent);

  removeRunAgent = (agentId: AgentId): Promise<void> => this.request("removeRunAgent", agentId);

  giveRequest = (key: string, agentId: AgentId): Promise<void> =>
    this.confirmed("give the request", (stopping) => this.request("giveRequest", key, agentId, stopping));

  stopRequests = (keys: string[]): Promise<void> => this.request("stopRequests", keys);

  /** Ask for a stage of a module to be written, giving the request to `agentId`, or to none. */
  askToWrite = (moduleId: string, stage: string, agentId: AgentId | null): Promise<void> =>
    this.confirmed("ask for the writing", (stopping) => this.request("askToWrite", moduleId, stage, agentId, stopping));

  /** Ask for a stage of a module to be reviewed, giving the request to `agentId`, or to none. */
  askToReview = (moduleId: string, stage: string, agentId: AgentId | null): Promise<void> =>
    this.confirmed("ask for the review", (stopping) => this.request("askToReview", moduleId, stage, agentId, stopping));

  /** Withdraw a waiting request no agent has. */
  withdrawRequest = (key: string): Promise<void> => this.request("withdrawRequest", key);
}
