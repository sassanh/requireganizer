import { Agent, type AgentEvent, type AgentMessage, type AgentTool, type StreamFn } from "@earendil-works/pi-agent-core";

import type { AgentToolDescription } from "../interface";
import type { AgentId, ContextTopic } from "../record";
import type { AgentRegistry } from "../registry";
import { templateStream } from "./gateway";
import { endpointModel } from "./model";

/** One run of an internal agent, as the module that hands it work asks for it. */
export interface RunRequest {
  topic: ContextTopic;
  /** What the agent is told of its work, besides who it is. */
  instructions: string;
  prompt: string;
  tools: readonly AgentToolDescription[];
  call(name: string, args: Record<string, unknown>): Promise<string>;
  /** How long a request to the AI provider may go without anything returned before the run fails. */
  requestTimeoutMs: number;
}

/** How a run ended: the agent stopped of itself, its AI provider failed, or it was aborted. */
export type RunOutcome = { kind: "ended" } | { kind: "failed"; why: string } | { kind: "aborted" };

interface Running {
  topic: string;
  agent: Agent | null;
  aborted: boolean;
}

/** An assistant message an aborted or failed request left, which a later request does not build on. */
function unfinished(message: unknown): boolean {
  if (message == null || typeof message !== "object") return false;
  const { role, stopReason } = message as { role?: unknown; stopReason?: unknown };
  return role === "assistant" && (stopReason === "error" || stopReason === "aborted");
}

const minutes = (ms: number) => `${Math.round(ms / 60_000)} minute${Math.round(ms / 60_000) === 1 ? "" : "s"}`;

/**
 * Runs internal agents, one run of an agent at a time, each with its whole
 * context so far and the template it was started from as that template is
 * at each request. Everything a run adds to the agent's context is kept
 * with the agent as it happens.
 */
export class InternalAgentRunner {
  private readonly running = new Map<AgentId, Running>();
  /** The topics of runs waiting for the agent's run before them, by agent. */
  private readonly waiting = new Map<AgentId, { topic: string; cancelled: boolean }[]>();
  private readonly tails = new Map<AgentId, Promise<unknown>>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly registry: AgentRegistry,
    /** The stream a run calls its AI provider on; the template's endpoint's unless given. */
    private readonly streamFor: (agentId: AgentId) => StreamFn = (agentId) => templateStream(() => registry.templateOf(agentId)),
  ) {}

  /** Hear when an agent starts or ends a run. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  /** The topic an agent runs on now; null while it runs on none. */
  runningTopic(agentId: AgentId): string | null {
    return this.running.get(agentId)?.topic ?? null;
  }

  /** Whether an agent runs, or waits to run, on a topic. */
  busyWith(agentId: AgentId, topic: string): boolean {
    return this.runningTopic(agentId) === topic || (this.waiting.get(agentId) ?? []).some((entry) => entry.topic === topic && !entry.cancelled);
  }

  /** Run an agent once its runs before have ended. */
  run(agentId: AgentId, request: RunRequest): Promise<RunOutcome> {
    const entry = { topic: request.topic.key, cancelled: false };
    this.waiting.set(agentId, [...(this.waiting.get(agentId) ?? []), entry]);
    const previous = this.tails.get(agentId) ?? Promise.resolve();
    const outcome = previous.then(async (): Promise<RunOutcome> => {
      this.waiting.set(agentId, (this.waiting.get(agentId) ?? []).filter((waiting) => waiting !== entry));
      if (entry.cancelled) return { kind: "aborted" };
      return this.runNow(agentId, request);
    });
    this.tails.set(agentId, outcome.catch(() => undefined));
    this.changed();
    return outcome;
  }

  /** Tell an agent something while it runs on a topic, after its current request; false when it runs on none. */
  steer(agentId: AgentId, topic: string, text: string): boolean {
    const running = this.running.get(agentId);
    if (running?.topic !== topic || running.agent == null) return false;
    running.agent.steer({ role: "user", content: text, timestamp: Date.now() });
    return true;
  }

  /** Abort an agent's run on a topic, and its runs on it still waiting. */
  abort(agentId: AgentId, topic: string): void {
    for (const entry of this.waiting.get(agentId) ?? []) if (entry.topic === topic) entry.cancelled = true;
    const running = this.running.get(agentId);
    if (running?.topic === topic) {
      running.aborted = true;
      running.agent?.abort();
    }
    this.changed();
  }

  /** Abort every run. */
  dispose(): void {
    for (const [agentId, running] of this.running) this.abort(agentId, running.topic);
  }

  private async runNow(agentId: AgentId, request: RunRequest): Promise<RunOutcome> {
    const running: Running = { topic: request.topic.key, agent: null, aborted: false };
    this.running.set(agentId, running);
    this.changed();
    const before = this.registry.context(agentId);
    const index = before.length;
    const from = new Date().toISOString();
    const prior = before.flatMap(({ messages }) => messages).filter((message) => !unfinished(message)) as AgentMessage[];
    // What the run added to the context so far, kept as it grows and closed once the run ends.
    let added: AgentMessage[] | null = null;
    const keep = (messages: readonly AgentMessage[]) => {
      added = [...messages];
      this.registry.keepContextPart(agentId, index, { topic: request.topic, from, until: null, messages: added });
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;
    const clearTimer = () => {
      if (timer != null) clearTimeout(timer);
      timer = null;
    };
    try {
      const template = this.registry.templateOf(agentId);
      const stream = this.streamFor(agentId);
      // Each request has the time allowed to return anything.
      const timedStream: StreamFn = (model, context, options) => {
        clearTimer();
        timer = setTimeout(() => {
          timedOut = true;
          running.agent?.abort();
        }, request.requestTimeoutMs);
        return stream(model, context, options);
      };
      const tools = request.tools.map((description): AgentTool => ({
        name: description.name,
        label: description.name,
        description: description.description,
        parameters: description.inputSchema as unknown as AgentTool["parameters"],
        execute: async (_toolCallId, params) => ({ content: [{ type: "text", text: await request.call(description.name, params as Record<string, unknown>) }], details: {} }),
      }));
      const agent = new Agent({
        initialState: {
          systemPrompt: `You are ${this.registry.label(agentId)}, an internal agent Requireganizer runs for the spec owner. ${request.instructions}`,
          model: endpointModel(template.model, template.endpoint),
          tools,
          messages: prior,
        },
        streamFn: timedStream,
      });
      running.agent = agent;
      if (running.aborted) return { kind: "aborted" };
      agent.subscribe((event: AgentEvent) => {
        if ((event.type === "message_start" || event.type === "message_update") && event.message.role === "assistant") clearTimer();
        if (event.type === "message_end") keep(agent.state.messages.slice(prior.length));
      });
      keep([]);
      await agent.prompt(request.prompt);
      clearTimer();
      keep(agent.state.messages.slice(prior.length));
      if (timedOut) return { kind: "failed", why: `The AI provider at ${template.endpoint} returned nothing within ${minutes(request.requestTimeoutMs)} of a request.` };
      if (running.aborted) return { kind: "aborted" };
      const { errorMessage } = agent.state;
      return errorMessage == null ? { kind: "ended" } : { kind: "failed", why: `The AI provider at ${template.endpoint} failed: ${errorMessage}` };
    } catch (error) {
      clearTimer();
      if (running.aborted) return { kind: "aborted" };
      return { kind: "failed", why: error instanceof Error ? error.message : String(error) };
    } finally {
      const kept = added as AgentMessage[] | null;
      if (kept != null) this.registry.keepContextPart(agentId, index, { topic: request.topic, from, until: new Date().toISOString(), messages: kept });
      this.running.delete(agentId);
      this.changed();
    }
  }
}
