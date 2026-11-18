import { UserFacingError } from "lib/errors";
import { uuid } from "utilities";

import { type RunAgent, runAgentProblems, type RunAgentsSource } from "./internal/runAgents";

/**
 * An agent, by the id the Agents module gives it: an agent Requireganizer
 * runs keeps its id while the spec owner keeps it; a coding agent is one
 * connection, so connecting again makes another agent.
 */
export type AgentId = string;

/** An agent as the spec owner sees it listed. */
export type AgentView =
  | { id: AgentId; kind: "run"; name: string; model: string; provider: string; baseUrl: string }
  | { id: AgentId; kind: "coding"; name: string | null; connectedAt: string };

export const runAgentId = (agent: RunAgent): AgentId => `run:${agent.id}`;
/** The agent a connection of a coding agent is. */
export const codingAgentId = (connection: string): AgentId => `coding:${connection}`;

/** The name of a provider as the spec owner reads it: its address's host. */
function providerName(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/** Names that differ only by the case of their letters count as the same. */
const sameName = (left: string, right: string) => left.toLocaleLowerCase() === right.toLocaleLowerCase();

/**
 * The agents of a project host: those Requireganizer runs, available from
 * when the spec owner adds one until they remove it, and each connection of
 * a coding agent, available from when it has a name until it ends.
 */
export class AgentRoster {
  private readonly connections = new Map<string, { name: string | null; connectedAt: string }>();
  private readonly listeners = new Set<() => void>();

  constructor(readonly runAgents: RunAgentsSource) {
    runAgents.subscribe(() => this.changed());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  /** Every agent, the unnamed coding agents included: those Requireganizer runs, then each connection in the order it connected. */
  list(): AgentView[] {
    return [
      ...this.runAgents.read().map((agent): AgentView => ({
        id: runAgentId(agent),
        kind: "run",
        name: agent.name,
        model: agent.model,
        provider: providerName(agent.provider.baseUrl),
        baseUrl: agent.provider.baseUrl,
      })),
      ...[...this.connections].map(([connection, { name, connectedAt }]): AgentView => ({ id: codingAgentId(connection), kind: "coding", name, connectedAt })),
    ];
  }

  /** The agents a request can be given to now: every agent that has a name. */
  available(): (AgentView & { name: string })[] {
    return this.list().filter((agent): agent is AgentView & { name: string } => agent.name != null);
  }

  isAvailable(id: AgentId): boolean {
    return this.available().some((agent) => agent.id === id);
  }

  /** An available agent's name; null for one that is not available. */
  nameOf(id: AgentId): string | null {
    return this.available().find((agent) => agent.id === id)?.name ?? null;
  }

  /** The agent Requireganizer runs under an id, while the spec owner keeps it. */
  runAgent(id: AgentId): RunAgent | null {
    return this.runAgents.read().find((agent) => runAgentId(agent) === id) ?? null;
  }

  /** The connection a coding agent is; null for an agent that is not a connected coding agent. */
  connectionOf(id: AgentId): string | null {
    return [...this.connections.keys()].find((connection) => codingAgentId(connection) === id) ?? null;
  }

  /** The coding agent a connection is; null once it ended or for a connection that is no agent's. */
  codingAgent(connection: string): AgentView | null {
    const known = this.connections.get(connection);
    return known == null ? null : { id: codingAgentId(connection), kind: "coding", ...known };
  }

  /**
   * Why `name` cannot be an agent's: it is empty, or another available
   * agent has it, letters of either case counting as the same. `self` is
   * the agent being named, whose own name does not count against it.
   */
  nameProblem(name: string, self: AgentId | null): string | null {
    if (name.trim().length === 0) return "A name cannot be empty.";
    const holder = this.available().find((agent) => agent.id !== self && sameName(agent.name, name.trim()));
    return holder == null ? null : `The ${holder.kind === "run" ? "agent Requireganizer runs" : "coding agent"} “${holder.name}” has that name. Choose another.`;
  }

  /** A coding agent connected, still without a name. Connecting again through the same connection changes nothing. */
  connect(connection: string): void {
    if (this.connections.has(connection)) return;
    this.connections.set(connection, { name: null, connectedAt: new Date().toISOString() });
    this.changed();
  }

  /** The connection ended, so the coding agent is no longer available. */
  disconnect(connection: string): void {
    if (this.connections.delete(connection)) this.changed();
  }

  /** Name a connected coding agent that has no name, as it names itself or as the spec owner names it. */
  nameCodingAgent(connection: string, name: string): void {
    const known = this.connections.get(connection);
    if (known == null) throw new UserFacingError("That coding agent is no longer connected.");
    if (known.name != null) throw new UserFacingError(`That coding agent already has the name “${known.name}”.`);
    const problem = this.nameProblem(name, codingAgentId(connection));
    if (problem != null) throw new UserFacingError(problem);
    this.connections.set(connection, { ...known, name: name.trim() });
    this.changed();
  }

  /** Add an agent Requireganizer runs; it is available at once. */
  addRunAgent(agent: Omit<RunAgent, "id">): AgentId {
    const added = { ...agent, id: uuid(), name: agent.name.trim() };
    this.checkRunAgent(added);
    this.runAgents.save([...this.runAgents.read(), added]);
    return runAgentId(added);
  }

  /** Change an agent Requireganizer runs: its name, its provider or its model; an empty API key keeps the one it has. */
  changeRunAgent(id: AgentId, agent: Omit<RunAgent, "id">): void {
    const current = this.runAgent(id);
    if (current == null) throw new UserFacingError("That agent was removed.");
    const apiKey = agent.provider.apiKey.length === 0 ? current.provider.apiKey : agent.provider.apiKey;
    const changed = { ...agent, provider: { ...agent.provider, apiKey }, id: current.id, name: agent.name.trim() };
    this.checkRunAgent(changed);
    this.runAgents.save(this.runAgents.read().map((kept) => (kept.id === current.id ? changed : kept)));
  }

  /** Remove an agent Requireganizer runs; it is no longer available, so no request is its any more. */
  removeRunAgent(id: AgentId): void {
    const current = this.runAgent(id);
    if (current == null) return;
    this.runAgents.save(this.runAgents.read().filter((kept) => kept.id !== current.id));
  }

  private checkRunAgent(agent: RunAgent): void {
    const problems = [this.nameProblem(agent.name, runAgentId(agent)), ...runAgentProblems(agent)].filter((problem) => problem != null);
    if (problems.length > 0) throw new UserFacingError(problems.join("\n"));
  }
}
