import type { AgentsHostApi, AgentsHostEvent } from "./host";
import type { AgentToolDescription } from "./interface";
import type { AgentId, ContextPart } from "./record";
import type { AgentNotice, Registration } from "./registry";
import type { TemplateDraft } from "./templates";
import { type AgentsView, EMPTY_AGENTS_VIEW } from "./view";

/** How a client sends one of the Agents module's calls to its host. */
export type AgentsRequest = <Name extends keyof AgentsHostApi>(
  name: Name,
  ...args: Parameters<AgentsHostApi[Name]>
) => Promise<Awaited<ReturnType<AgentsHostApi[Name]>>>;

/**
 * Carries out an action the host may refuse until the spec owner confirms
 * what it concerns: `send` is called with what they confirmed, if anything.
 * Another module provides it; without one, an action is sent as it is.
 */
export type ActionGate = <Value>(action: string, send: (confirmed?: string[]) => Promise<Value>) => Promise<Value>;

const UNGATED: ActionGate = (_action, send) => send();

/**
 * The Agents module as a client of a project host holds it: the agents and
 * templates the host sends, the coding agent this client is when it is one,
 * and the spec owner's actions on agents and templates.
 */
export class AgentsClient {
  private view: AgentsView = EMPTY_AGENTS_VIEW;
  private readonly noticeListeners = new Set<(notice: AgentNotice) => void>();
  /** For a client that is a coding agent: what its coding tool tells, sent again with each new connection. */
  private registration: Registration | null = null;
  private gate: ActionGate = UNGATED;

  constructor(
    private readonly request: AgentsRequest,
    /** Tell the client's subscribers that the agents changed. */
    private readonly changed: () => void,
  ) {}

  getView = (): AgentsView => this.view;

  /** Take an agents event from the host. */
  receive(event: AgentsHostEvent): void {
    switch (event.type) {
      case "agents":
        this.view = event.view;
        this.changed();
        return;
      case "agent-notice":
        for (const listener of this.noticeListeners) listener(event.notice);
        return;
    }
  }

  /** A connection to the host opened: a coding agent's client registers again on each. */
  connected(): void {
    const registration = this.registration;
    if (registration == null) return;
    this.request("registerAgent", registration).catch((error: unknown) => console.error("Could not register as a coding agent.", error));
  }

  /** Connect as a coding agent, as its coding tool tells; registers now if connected, and on every connection from now on. */
  actAsCodingAgent = (registration: Registration, connectedNow: boolean): void => {
    this.registration = registration;
    if (connectedNow) this.connected();
  };

  /** Hear each message meant for this coding agent's session. */
  subscribeNotices = (listener: (notice: AgentNotice) => void): (() => void) => {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  };

  /** Let another module confirm actions that concern its work, such as archiving an agent that has some. */
  setGate = (gate: ActionGate | null): void => {
    this.gate = gate ?? UNGATED;
  };

  listAgentTools = (): Promise<AgentToolDescription[]> => this.request("listAgentTools");

  callAgentTool = (name: string, args: Record<string, unknown>): Promise<string> => this.request("callAgentTool", name, args);

  agentInstructions = (): Promise<string> => this.request("agentInstructions");

  addTemplate = (template: TemplateDraft): Promise<void> => this.request("addTemplate", template);

  changeTemplate = (templateId: string, template: TemplateDraft): Promise<void> => this.request("changeTemplate", templateId, template);

  removeTemplate = (templateId: string): Promise<void> => this.request("removeTemplate", templateId);

  startInternalAgent = (templateId: string, name: string | null): Promise<AgentId> => this.request("startInternalAgent", templateId, name);

  nameAgent = (agentId: AgentId, name: string): Promise<void> => this.request("nameAgent", agentId, name);

  archiveAgent = (agentId: AgentId): Promise<void> => this.gate("archive the agent", (confirmed) => this.request("archiveAgent", agentId, confirmed));

  restoreAgent = (agentId: AgentId): Promise<void> => this.request("restoreAgent", agentId);

  answerLetIn = (agentId: AgentId, letIn: boolean): Promise<void> => this.request("answerLetIn", agentId, letIn);

  readContext = (agentId: AgentId): Promise<ContextPart[]> => this.request("readContext", agentId);
}
