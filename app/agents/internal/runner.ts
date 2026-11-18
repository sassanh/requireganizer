import { Agent, type AgentTool, type StreamFn } from "@earendil-works/pi-agent-core";


import type { AgentDesk, AgentNotice } from "../desk";
import { providerStream } from "./gateway";
import { gatewayModel } from "./model";
import { replyRulesText } from "../interface/replyRules";
import type { AgentToolDescription } from "../interface/tools";
import type { AgentRequest } from "../requests";
import type { AgentId } from "../roster";

/** The agent interface as an agent Requireganizer runs reaches it: the host's tools, called as that agent. */
export interface AgentInterfaceAccess {
  list(): Promise<AgentToolDescription[]>;
  call(agentId: AgentId, name: string, args: Record<string, unknown>): Promise<string>;
}

/** What the agent is asked to do with a request given to it. */
function requestPrompt(request: AgentRequest, summary: string): string {
  switch (request.kind) {
    case "change":
      return `The spec owner gives you a change request: ${summary}. Read thread ${request.thread!.id} with get_thread, then answer it with reply_to_thread, or with write_items and its answers when items must change.`;
    case "write":
      return `The spec owner gives you a request to write a stage: ${summary}. Read the rules of its kinds of item with get_stage_rules (stage ${request.stage}) and the stages it builds on with get_items, then write it with write_items, passing fulfils: "${request.stage}" in the write that completes it.`;
    case "review":
      return `The spec owner gives you a request to review a stage: ${summary}. Read the rules of its kinds of item with get_stage_rules (stage ${request.stage}) and its items with get_items, then answer with answer_review, naming each item that breaks a published rule, the rule and how.`;
  }
}

function systemPrompt(name: string): string {
  return `You are ${name}, an agent Requireganizer runs for the spec owner. You work on the spec only through your tools, which read the spec and its published rules, write items and answer the spec owner's requests. Answer only the request you are given. When you cannot answer it, say why with report_cannot_answer. ${replyRulesText()}`;
}

/**
 * Has each agent Requireganizer runs answer every request given to it,
 * with the AI provider and the model set for that agent. A request it is
 * stopped on is dropped at once; one its provider fails on goes back to no
 * agent, with why.
 */
export class RunAgentWorker {
  private readonly running = new Map<string, Agent>();

  constructor(
    private readonly desk: AgentDesk,
    private readonly access: AgentInterfaceAccess,
    /** The stream an agent's provider is called on; its own provider's unless given. */
    private readonly streamFor: (apiKey: string) => StreamFn = providerStream,
  ) {}

  /** Start answering; returns how to stop. */
  start(): () => void {
    const stop = this.desk.subscribeNotices((agentId, notice) => this.heard(agentId, notice));
    // A request whose agent is removed is no agent's: its run stops.
    const stopWatchingAgents = this.desk.roster.subscribe(() => {
      for (const [key, agent] of this.running) {
        if (this.desk.holderOf(key) != null) continue;
        agent.abort();
        this.running.delete(key);
      }
    });
    return () => {
      stop();
      stopWatchingAgents();
      for (const agent of this.running.values()) agent.abort();
      this.running.clear();
    };
  }

  private heard(agentId: AgentId, notice: AgentNotice): void {
    if (this.desk.roster.runAgent(agentId) == null) return;
    if (notice.type === "stopped") {
      this.running.get(notice.request.key)?.abort();
      this.running.delete(notice.request.key);
      return;
    }
    void this.answer(agentId, notice.request, notice.summary);
  }

  private async answer(agentId: AgentId, request: AgentRequest, summary: string): Promise<void> {
    const settings = this.desk.roster.runAgent(agentId)!;
    const fail = (why: string) => {
      // Stopped or answered meanwhile: nothing is the agent's to report.
      if (this.desk.holderOf(request.key)?.agentId === agentId) this.desk.fail(request.key, agentId, why);
    };
    try {
      const descriptions = await this.access.list();
      const tools = descriptions.map((description): AgentTool => ({
        name: description.name,
        label: description.name,
        description: description.description,
        parameters: description.inputSchema as unknown as AgentTool["parameters"],
        execute: async (_toolCallId, params) => ({
          content: [{ type: "text", text: await this.access.call(agentId, description.name, params as Record<string, unknown>) }],
          details: {},
        }),
      }));
      const agent = new Agent({
        initialState: { systemPrompt: systemPrompt(settings.name), model: gatewayModel(settings.model, settings.provider.baseUrl), tools },
        streamFn: this.streamFor(settings.provider.apiKey),
      });
      this.running.set(request.key, agent);
      await agent.prompt(requestPrompt(request, summary));
      if (this.running.get(request.key) !== agent) return;
      this.running.delete(request.key);
      const { errorMessage } = agent.state;
      if (errorMessage != null) fail(`${settings.provider.baseUrl} failed to answer: ${errorMessage}`);
      else fail("It stopped without answering the request.");
    } catch (error) {
      this.running.delete(request.key);
      fail(`${settings.provider.baseUrl} failed to answer: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
