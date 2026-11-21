import { Agent, type AgentEvent, type AgentTool, type StreamFn } from "@earendil-works/pi-agent-core";

import type { AgentDesk, AgentNotice } from "../desk";
import { providerStream } from "./gateway";
import { gatewayModel } from "./model";
import { disclosedThinking } from "./thinking";
import { replyRulesText } from "../interface/replyRules";
import type { AgentToolDescription } from "../interface/tools";
import type { AgentId } from "../roster";
import { assignmentPrompt, type WaitingThread } from "../waiting";

/** The agent interface as an agent Requireganizer runs reaches it: the host's tools, called as that agent. */
export interface AgentInterfaceAccess {
  list(): Promise<AgentToolDescription[]>;
  call(agentId: AgentId, name: string, args: Record<string, unknown>): Promise<string>;
}

function systemPrompt(name: string): string {
  return `You are ${name}, an agent Requireganizer runs for the spec owner. You work on the spec only through your tools, which read the spec and its published rules, write items and answer the spec owner's threads. Answer only the thread assigned to you. When you cannot answer it, say why with report_cannot_answer. ${replyRulesText()}`;
}

/**
 * Has each agent Requireganizer runs answer every thread assigned to it,
 * with the AI provider and the model set for that agent, keeping with the
 * thread each call it makes through the agent interface and the reasoning
 * its provider discloses. A run ends once the agent no longer has the
 * thread, whether it answered it or was stopped; one its provider fails on
 * goes back to no agent, with why.
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
    // A thread no agent has any more, answered, or whose agent was removed, ends its run.
    const endRuns = () => {
      for (const [key, agent] of this.running) {
        if (this.desk.holderOf(key) != null) continue;
        agent.abort();
        this.running.delete(key);
      }
    };
    const stopWatchingAgents = this.desk.roster.subscribe(endRuns);
    const stopWatchingDesk = this.desk.subscribe(endRuns);
    return () => {
      stop();
      stopWatchingAgents();
      stopWatchingDesk();
      for (const agent of this.running.values()) agent.abort();
      this.running.clear();
    };
  }

  private heard(agentId: AgentId, notice: AgentNotice): void {
    if (this.desk.roster.runAgent(agentId) == null) return;
    if (notice.type === "stopped") {
      this.running.get(notice.waiting.key)?.abort();
      this.running.delete(notice.waiting.key);
      return;
    }
    void this.answer(agentId, notice.waiting, notice.summary);
  }

  private async answer(agentId: AgentId, waiting: WaitingThread, summary: string): Promise<void> {
    const settings = this.desk.roster.runAgent(agentId)!;
    const fail = (why: string) => {
      // Stopped or answered meanwhile: nothing is the agent's to report.
      if (this.desk.holderOf(waiting.key)?.agentId === agentId) this.desk.fail(waiting.key, agentId, why);
    };
    try {
      const descriptions = await this.access.list();
      const tools = descriptions.map((description): AgentTool => ({
        name: description.name,
        label: description.name,
        description: description.description,
        parameters: description.inputSchema as unknown as AgentTool["parameters"],
        execute: async (_toolCallId, params) => {
          const sent = params as Record<string, unknown>;
          const log = (got: string, refused: boolean) =>
            this.desk.logRun(waiting.key, agentId, { kind: "call", at: new Date().toISOString(), tool: description.name, sent, got, refused });
          let got: string;
          try {
            got = await this.access.call(agentId, description.name, sent);
          } catch (error) {
            log(error instanceof Error ? error.message : String(error), true);
            throw error;
          }
          log(got, false);
          return { content: [{ type: "text", text: got }], details: {} };
        },
      }));
      const agent = new Agent({
        initialState: { systemPrompt: systemPrompt(settings.name), model: gatewayModel(settings.model, settings.provider.baseUrl), tools },
        streamFn: this.streamFor(settings.provider.apiKey),
      });
      // The reasoning of each answer of the provider comes before the calls it makes.
      agent.subscribe((event: AgentEvent) => {
        if (event.type !== "message_end" || event.message.role !== "assistant") return;
        for (const block of event.message.content) {
          if (block.type !== "thinking") continue;
          const text = disclosedThinking(block);
          if (text.length > 0) this.desk.logRun(waiting.key, agentId, { kind: "reasoning", at: new Date().toISOString(), text });
        }
      });
      this.running.set(waiting.key, agent);
      await agent.prompt(assignmentPrompt(waiting, summary));
      if (this.running.get(waiting.key) !== agent) return;
      this.running.delete(waiting.key);
      const { errorMessage } = agent.state;
      if (errorMessage != null) fail(`${settings.provider.baseUrl} failed to answer: ${errorMessage}`);
      else fail("It stopped without answering the thread.");
    } catch (error) {
      this.running.delete(waiting.key);
      fail(`${settings.provider.baseUrl} failed to answer: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
