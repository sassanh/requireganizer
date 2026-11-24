import type { AgentId, ConnectionDetails } from "./record";
import type { TemplateView } from "./templates";

/** An agent as the page and other modules see it. */
export interface AgentView {
  id: AgentId;
  kind: "internal" | "coding";
  name: string | null;
  /** Tells the agent apart from every other agent, shown while it has no name. */
  identifier: string;
  archived: boolean;
  /** For an internal agent: the template it was started from. */
  template: { id: string; name: string } | null;
  /** For a coding agent: whether a connection of it is open now. */
  connected: boolean;
  /** For a coding agent: whether the spec owner let it in since it last named itself or its session last connected. */
  letIn: boolean;
  /** For a coding agent: whether the spec owner is asked now whether to let it in. */
  askingToLetIn: boolean;
  /** For a coding agent: what its connection tells, or last told, of it. */
  details: ConnectionDetails | null;
  /** For a coding agent: the id of its session, to resume it, when this computer kept it; null otherwise. */
  session: string | null;
  /** The project can send a message into its session: always for an internal agent; for a coding agent, while it is connected through a coding tool that lets it. */
  reachable: boolean;
}

/** The agents and the spec owner's templates, as the page sees them. */
export interface AgentsView {
  agents: AgentView[];
  templates: TemplateView[];
}

export const EMPTY_AGENTS_VIEW: AgentsView = { agents: [], templates: [] };

/** The part of an agent's id that tells it apart from every other agent. */
export const identifierOf = (id: AgentId): string => id.replace(/-/g, "").slice(0, 8);

/**
 * An agent as the spec owner reads it wherever it appears: by its name,
 * marked once archived; or, while it has no name, marked as unnamed, with
 * its identifier and, for an internal agent, its template's name.
 */
export function agentLabel(agent: AgentView): string {
  if (agent.name != null) return agent.archived ? `${agent.name} (archived)` : agent.name;
  return `Unnamed agent ${agent.identifier}${agent.template == null ? "" : ` · ${agent.template.name}`}`;
}

/** Names that differ only by the case of their letters count as the same. */
export const sameName = (left: string, right: string): boolean => left.toLocaleLowerCase() === right.toLocaleLowerCase();

/**
 * What a name written down for an agent, such as on a step of the history,
 * reads as now. A name is never another agent's, so it names one agent for
 * good; a name no agent has, such as a label written while an agent had no
 * name, reads as written.
 */
export function labelOfName(agents: readonly AgentView[], name: string): string {
  const agent = agents.find((candidate) => candidate.name != null && candidate.name === name);
  return agent == null ? name : agentLabel(agent);
}

/** The agent with an id, labelled as the spec owner reads it; null for none. */
export function labelOfId(agents: readonly AgentView[], id: AgentId): string | null {
  const agent = agents.find((candidate) => candidate.id === id);
  return agent == null ? null : agentLabel(agent);
}
