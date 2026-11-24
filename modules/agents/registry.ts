import { UserFacingError } from "lib/errors";
import { uuid } from "utilities";

import { type AgentId, type ConnectionDetails, type ContextPart, parseStoredAgents, type StoredAgent, storedAgentsRecord } from "./record";
import type { SessionsSource } from "./sessions";
import { type Template, type TemplatesSource, templateView } from "./templates";
import { agentLabel, type AgentsView, type AgentView, identifierOf, sameName } from "./view";

/** A message sent into a coding agent's session: its text and what it is about. */
export interface AgentNotice {
  content: string;
  meta: Record<string, string>;
}

/** What a coding agent's connection tells when it opens. */
export interface Registration {
  /** The hash of the session its coding tool tells; null for a coding tool that tells none. */
  session: string | null;
  /** The session id itself, kept only on this computer, never in the project; null for a coding tool that tells none. */
  sessionId: string | null;
  details: ConnectionDetails;
}

/** A connection of a coding agent to the project, while it is open. */
interface LiveConnection {
  session: string | null;
  details: ConnectionDetails;
  tell: (notice: AgentNotice) => void;
  /** For a sessionless connection: the agents that named themselves or called through it. */
  sessionless: Set<AgentId>;
}

/** The agent a call comes from, once the call may go on. */
export interface CallingAgent {
  id: AgentId;
  kind: "internal" | "coding";
  /** The agent as the spec owner reads it, which signs what it writes. */
  label: string;
}

/** Who calls the agent interface: a coding agent through a connection, or an internal agent the system runs. */
export type AgentCaller = { connection: string } | { internalAgent: AgentId };

/** Why a name is refused, told to the agent that gave it and to the spec owner. */
interface NameRefusal {
  forAgent: string;
  forSpecOwner: string;
}

/** The one tool a coding agent may call before it is let in. */
export const NAME_TOOL = "name_yourself";

/** What a coding agent that has no name is told, as it connects and whenever it calls another tool. */
export const NAME_YOURSELF_TEXT = `Before anything else, give yourself a name with ${NAME_TOOL}: take it from your conversation with your user, or ask your user for one when that conversation gives none.`;

const now = () => new Date().toISOString();

/**
 * The agents of the open project: the internal agents and the named coding
 * agents it keeps, each connection of a coding agent while it is open, the
 * agents not named yet, and whom the spec owner let in. Every rule on names,
 * sessions, ids and letting in lives here.
 */
export class AgentRegistry {
  private stored: StoredAgent[] = [];
  private readonly connections = new Map<string, LiveConnection>();
  /** The agent of each session whose coding agent has no name yet, while a connection of it is open. */
  private readonly unnamedSessions = new Map<string, AgentId>();
  /** Coding agents the spec owner let in since they last named themselves or their session last connected. */
  private readonly letIn = new Set<AgentId>();
  /** Coding agents the spec owner is asked whether to let in. */
  private readonly asking = new Set<AgentId>();
  private readonly listeners = new Set<() => void>();
  private readonly archivedListeners = new Set<(agentId: AgentId) => void>();
  private readonly letInListeners = new Set<(agentId: AgentId) => void>();

  constructor(
    readonly templates: TemplatesSource,
    /** Where this computer keeps each coding agent's session id. */
    private readonly sessions: SessionsSource,
    /** Keep the agents beside the open project; nothing while none is open. */
    private readonly keep: (record: unknown) => void,
  ) {
    templates.subscribe(() => this.changed());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Hear of each agent the spec owner archives, once it is archived. */
  onArchived(listener: (agentId: AgentId) => void): () => void {
    this.archivedListeners.add(listener);
    return () => this.archivedListeners.delete(listener);
  }

  /** Hear of each coding agent the spec owner lets in. */
  onLetIn(listener: (agentId: AgentId) => void): () => void {
    this.letInListeners.add(listener);
    return () => this.letInListeners.delete(listener);
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  private save(stored: StoredAgent[]): void {
    this.stored = stored;
    this.keep(storedAgentsRecord(stored));
    this.changed();
  }

  private update(agentId: AgentId, change: (agent: StoredAgent) => StoredAgent): void {
    this.save(this.stored.map((agent) => (agent.id === agentId ? change(agent) : agent)));
  }

  /**
   * A project opened, with the agents its record keeps. No coding agent is
   * let in; each whose session is connected now is asked about, as its
   * session connected again.
   */
  load(record: unknown): void {
    this.stored = parseStoredAgents(record);
    this.letIn.clear();
    this.asking.clear();
    this.unnamedSessions.clear();
    for (const connection of this.connections.values()) {
      if (connection.session == null) {
        connection.sessionless.clear();
        continue;
      }
      const named = this.namedOfSession(connection.session);
      if (named == null) this.unnamedOfSession(connection.session);
      else this.asking.add(named.id);
    }
    this.changed();
  }

  /** The open project's agents, the unnamed coding agents connected now included. */
  view(): AgentsView {
    return { agents: this.agentViews(), templates: this.templates.read().map(templateView) };
  }

  private agentViews(): AgentView[] {
    const templates = this.templates.read();
    const kept = this.stored.map((agent): AgentView => {
      if (agent.kind === "internal") {
        const template = templates.find(({ id }) => id === agent.templateId);
        return {
          id: agent.id,
          kind: "internal",
          name: agent.name,
          identifier: identifierOf(agent.id),
          archived: agent.archivedAt != null,
          template: { id: agent.templateId, name: template?.name ?? agent.templateName },
          connected: false,
          letIn: true,
          askingToLetIn: false,
          details: null,
          session: null,
          reachable: agent.archivedAt == null,
        };
      }
      const live = agent.archivedAt == null ? this.connectionsOf(agent.id) : [];
      return {
        id: agent.id,
        kind: "coding",
        name: agent.name,
        identifier: identifierOf(agent.id),
        archived: agent.archivedAt != null,
        template: null,
        connected: live.length > 0,
        letIn: this.letIn.has(agent.id),
        askingToLetIn: this.asking.has(agent.id),
        details: live.at(-1)?.details ?? agent.details,
        session: agent.session == null ? null : this.sessions.idOf(agent.session),
        reachable: live.some(({ details }) => details.reachable),
      };
    });
    const unnamed = [...this.unnamedSessions].map(([session, id]): AgentView => {
      const live = [...this.connections.values()].filter((connection) => connection.session === session);
      return {
        id,
        kind: "coding",
        name: null,
        identifier: identifierOf(id),
        archived: false,
        template: null,
        connected: true,
        letIn: false,
        askingToLetIn: false,
        details: live.at(-1)?.details ?? null,
        session: this.sessions.idOf(session),
        reachable: live.some(({ details }) => details.reachable),
      };
    });
    return [...kept, ...unnamed];
  }

  /** An agent as others see it; null for an id no agent has. */
  agent(agentId: AgentId): AgentView | null {
    return this.agentViews().find(({ id }) => id === agentId) ?? null;
  }

  /** An agent's label as the spec owner reads it; the id itself for an id no agent has. */
  label(agentId: AgentId): string {
    const agent = this.agent(agentId);
    return agent == null ? agentId : agentLabel(agent);
  }

  // Coding agents and their connections.

  private namedOfSession(session: string): (StoredAgent & { kind: "coding" }) | null {
    return this.stored.find((agent): agent is StoredAgent & { kind: "coding" } => agent.kind === "coding" && agent.archivedAt == null && agent.session === session) ?? null;
  }

  /** The unnamed coding agent of a session, made the first time it is needed. */
  private unnamedOfSession(session: string): AgentId {
    let id = this.unnamedSessions.get(session);
    if (id == null) {
      id = uuid();
      this.unnamedSessions.set(session, id);
    }
    return id;
  }

  /** The open connections of a coding agent. */
  private connectionsOf(agentId: AgentId): LiveConnection[] {
    const agent = this.stored.find(({ id }) => id === agentId);
    return [...this.connections.values()].filter((connection) => {
      if (connection.session != null) return agent?.kind === "coding" && agent.archivedAt == null ? agent.session === connection.session : this.unnamedSessions.get(connection.session) === agentId;
      return connection.sessionless.has(agentId);
    });
  }

  /**
   * A coding agent's connection opened. All connections a coding tool tells
   * of the same session are one coding agent; once every connection of a
   * named one had ended, its session connecting again asks the spec owner
   * whether to let it in.
   */
  connect(connection: string, registration: Registration, tell: (notice: AgentNotice) => void): void {
    const { session, sessionId, details } = registration;
    if (session != null && sessionId != null) this.sessions.remember(session, sessionId);
    const again = session != null && ![...this.connections.values()].some((other) => other.session === session);
    this.connections.set(connection, { session, details, tell, sessionless: new Set() });
    if (session != null) {
      const named = this.namedOfSession(session);
      if (named == null) this.unnamedOfSession(session);
      else {
        if (again) {
          this.letIn.delete(named.id);
          this.asking.add(named.id);
        }
        this.update(named.id, (agent) => ({ ...agent, details }));
        return;
      }
    }
    this.changed();
  }

  /** A connection ended; the agents it served stay, with their names. */
  disconnect(connection: string): void {
    const ended = this.connections.get(connection);
    if (ended == null) return;
    this.connections.delete(connection);
    if (ended.session != null && ![...this.connections.values()].some(({ session }) => session === ended.session)) {
      this.unnamedSessions.delete(ended.session);
      const named = this.namedOfSession(ended.session);
      if (named != null) this.asking.delete(named.id);
    }
    this.changed();
  }

  /** Whether a coding agent's connection tells no session. */
  isSessionless(connection: string): boolean {
    return this.connections.get(connection)?.session === null;
  }

  /** The coding agent a sessionless call names by the id the system gave it; null when the id is an archived agent's, whose later use is a new agent's. */
  private sessionlessAgent(agentId: unknown): (StoredAgent & { kind: "coding" }) | null {
    if (typeof agentId !== "string") return null;
    const agent = this.stored.find((candidate) => candidate.id === agentId);
    if (agent == null || agent.kind !== "coding" || agent.session != null) {
      throw new UserFacingError(`${JSON.stringify(agentId)} is no id the system gave a coding agent. Name yourself with ${NAME_TOOL} without an agentId to be given one.`);
    }
    return agent.archivedAt == null ? agent : null;
  }

  /**
   * The agent a call comes from, refused unless it may call more than
   * `name_yourself`: an internal agent that is not archived, or a coding
   * agent that has a name and that the spec owner let in since it last
   * named itself or its session last connected. A sessionless coding agent
   * passes the id the system gave it with every call.
   */
  caller(caller: AgentCaller, givenId: unknown): CallingAgent {
    if ("internalAgent" in caller) {
      const agent = this.agent(caller.internalAgent);
      if (agent == null || agent.kind !== "internal" || agent.archived) throw new UserFacingError("This agent is archived.");
      return { id: agent.id, kind: "internal", label: agentLabel(agent) };
    }
    const connection = this.connections.get(caller.connection);
    if (connection == null) throw new UserFacingError("This connection to the project has ended.");
    let agentId: AgentId;
    if (connection.session != null) {
      const named = this.namedOfSession(connection.session);
      if (named == null) throw new UserFacingError(`You have no name yet, so nothing else is open to you. ${NAME_YOURSELF_TEXT}`);
      agentId = named.id;
    } else {
      if (givenId == null) {
        throw new UserFacingError(`Pass agentId, the id the system gave you when you named yourself, with every call. If you have none, ${NAME_YOURSELF_TEXT.charAt(0).toLowerCase()}${NAME_YOURSELF_TEXT.slice(1)}`);
      }
      const agent = this.sessionlessAgent(givenId);
      if (agent == null) throw new UserFacingError(`That id is an archived agent's, so you are a new coding agent with no name. ${NAME_YOURSELF_TEXT}`);
      agentId = agent.id;
      if (!connection.sessionless.has(agentId)) {
        connection.sessionless.add(agentId);
        this.changed();
      }
    }
    if (!this.letIn.has(agentId)) {
      throw new UserFacingError(
        this.asking.has(agentId)
          ? "The spec owner has not let you in yet, so nothing but naming yourself is open to you. They are asked whether to let you in; wait for them, then call again."
          : `The spec owner has not let you in, so nothing but naming yourself is open to you. Name yourself again with ${NAME_TOOL} to be asked about again.`,
      );
    }
    return { id: agentId, kind: "coding", label: this.label(agentId) };
  }

  /** Why a name cannot be an agent's; null when it can. `self` is the agent named, whose own name does not count against it. */
  private nameRefusal(name: string, self: AgentId | null): NameRefusal | null {
    if (name.trim().length === 0) return { forAgent: "A name cannot be empty.", forSpecOwner: "A name cannot be empty." };
    const holder = this.agentViews().find((agent) => agent.id !== self && agent.name != null && sameName(agent.name, name.trim()));
    if (holder == null) return null;
    const state = holder.archived ? ", archived," : holder.kind === "coding" && !holder.connected ? ", not connected," : "";
    return {
      forAgent: `Another agent has the name “${holder.name}”. The spec owner may be talking to the wrong agent: tell them so, and do not take another name to carry on.`,
      forSpecOwner: `Another agent${state} has the name “${holder.name}”, so no other agent can have it.`,
    };
  }

  /** The spec owner is asked whether to let a coding agent in. */
  private ask(agentId: AgentId): void {
    this.letIn.delete(agentId);
    this.asking.add(agentId);
  }

  /**
   * A coding agent names itself through a connection, or names itself again,
   * such as after its session connected again; the spec owner is then asked
   * whether to let it in. A sessionless one is given an id of its own the
   * first time, and gets the same id back each time it passes it. Returns
   * the id of a sessionless agent; null for one its session names.
   */
  nameSelf(connection: string, name: string, givenId: unknown): { agentId: AgentId; sessionless: boolean } {
    const live = this.connections.get(connection);
    if (live == null) throw new UserFacingError("This connection to the project has ended.");
    const trimmed = name.trim();
    const existing: (StoredAgent & { kind: "coding" }) | null = live.session != null ? this.namedOfSession(live.session) : givenId == null ? null : this.sessionlessAgent(givenId);
    if (existing != null) {
      if (!sameName(existing.name, trimmed)) {
        throw new UserFacingError(`You already have the name “${existing.name}”, and an agent keeps its name. The spec owner may be talking to the wrong agent: tell them so, and do not take another name to carry on.`);
      }
      if (live.session == null) live.sessionless.add(existing.id);
      this.ask(existing.id);
      this.update(existing.id, (agent) => ({ ...agent, details: live.details }));
      return { agentId: existing.id, sessionless: live.session == null };
    }
    const id = live.session == null ? uuid() : this.unnamedOfSession(live.session);
    const refusal = this.nameRefusal(trimmed, id);
    if (refusal != null) throw new UserFacingError(refusal.forAgent);
    if (live.session != null) this.unnamedSessions.delete(live.session);
    else live.sessionless.add(id);
    this.ask(id);
    this.save([...this.stored, { id, kind: "coding", name: trimmed, session: live.session, namedAt: now(), archivedAt: null, details: live.details }]);
    return { agentId: id, sessionless: live.session == null };
  }

  /**
   * The spec owner names an agent that has no name: an internal agent, or a
   * connected coding agent, which is then let in, since the spec owner chose
   * it. Refused with why, for the spec owner.
   */
  nameBySpecOwner(agentId: AgentId, name: string): void {
    const trimmed = name.trim();
    const refusal = this.nameRefusal(trimmed, agentId);
    if (refusal != null) throw new UserFacingError(refusal.forSpecOwner);
    const kept = this.stored.find(({ id }) => id === agentId);
    if (kept != null) {
      if (kept.name != null) throw new UserFacingError(`That agent already has the name “${kept.name}”, and an agent keeps its name.`);
      this.update(agentId, (agent) => ({ ...agent, name: trimmed }));
      return;
    }
    const session = [...this.unnamedSessions].find(([, id]) => id === agentId)?.[0];
    if (session == null) throw new UserFacingError("That coding agent is no longer connected, so it names itself when it connects again.");
    const details = [...this.connections.values()].findLast((connection) => connection.session === session)!.details;
    this.unnamedSessions.delete(session);
    this.letIn.add(agentId);
    this.save([...this.stored, { id: agentId, kind: "coding", name: trimmed, session, namedAt: now(), archivedAt: null, details }]);
    for (const listener of this.letInListeners) listener(agentId);
  }

  /** The spec owner lets a coding agent in, or refuses to, which the agent is told. */
  answerLetIn(agentId: AgentId, letIn: boolean): void {
    const agent = this.agent(agentId);
    if (agent == null || agent.kind !== "coding" || agent.archived) throw new UserFacingError("That coding agent is archived.");
    if (!this.asking.delete(agentId)) throw new UserFacingError(`${agentLabel(agent)} is no longer asking to be let in.`);
    if (letIn) {
      this.letIn.add(agentId);
      this.changed();
      this.tell(agentId, { content: `The spec owner let you in as “${agent.name}”: the project is open to you.`, meta: { letIn: "true" } });
      for (const listener of this.letInListeners) listener(agentId);
      return;
    }
    this.changed();
    this.tell(agentId, { content: `The spec owner did not let you in as “${agent.name}”, so nothing but naming yourself is open to you. If they meant you to work on the project, ask them; do not take another name to carry on.`, meta: { refused: "true" } });
  }

  /**
   * Send a message into a coding agent's session, through its latest open
   * connection whose coding tool lets the project do so. False when it could
   * not be sent.
   */
  tell(agentId: AgentId, notice: AgentNotice): boolean {
    const connection = this.connectionsOf(agentId).findLast(({ details }) => details.reachable);
    if (connection == null) return false;
    connection.tell(notice);
    return true;
  }

  // Internal agents.

  private template(templateId: string): Template {
    const template = this.templates.read().find(({ id }) => id === templateId);
    if (template == null) throw new UserFacingError("That template was removed.");
    return template;
  }

  /** Start a new internal agent from a template, with a name or with none. */
  startInternal(templateId: string, name: string | null): AgentId {
    const template = this.template(templateId);
    const id = uuid();
    if (name != null) {
      const refusal = this.nameRefusal(name, id);
      if (refusal != null) throw new UserFacingError(refusal.forSpecOwner);
    }
    this.save([...this.stored, { id, kind: "internal", name: name?.trim() ?? null, templateId, templateName: template.name, startedAt: now(), archivedAt: null, context: [] }]);
    return id;
  }

  /** The template an internal agent uses now: the one it was started from, as that template is at the time. */
  templateOf(agentId: AgentId): Template {
    const agent = this.stored.find(({ id }) => id === agentId);
    if (agent?.kind !== "internal") throw new UserFacingError("That is not an internal agent.");
    return this.template(agent.templateId);
  }

  /** An internal agent's context, oldest part first. */
  context(agentId: AgentId): ContextPart[] {
    const agent = this.stored.find(({ id }) => id === agentId);
    return agent?.kind === "internal" ? agent.context : [];
  }

  /** Keep the part of an internal agent's context its run now holds, replacing that part as it grows. */
  keepContextPart(agentId: AgentId, index: number, part: ContextPart): void {
    this.update(agentId, (agent) => {
      if (agent.kind !== "internal") return agent;
      const context = [...agent.context];
      context[index] = part;
      return { ...agent, context };
    });
  }

  // Templates.

  addTemplate(template: Template): void {
    this.templates.save([...this.templates.read(), template]);
  }

  changeTemplate(template: Template): void {
    this.templates.save(this.templates.read().map((kept) => (kept.id === template.id ? template : kept)));
  }

  /** Remove a template, refused while an internal agent that is not archived was started from it, naming each such agent. */
  removeTemplate(templateId: string): void {
    const template = this.template(templateId);
    const users = this.agentViews().filter((agent) => agent.kind === "internal" && !agent.archived && agent.template?.id === templateId);
    if (users.length > 0) {
      throw new UserFacingError(`${template.name} cannot be removed while ${users.length === 1 ? "this agent was" : "these agents were"} started from it and ${users.length === 1 ? "is" : "are"} not archived: ${users.map(agentLabel).join(", ")}.`);
    }
    this.templates.save(this.templates.read().filter(({ id }) => id !== templateId));
  }

  // Archiving.

  /** Archive an agent that has a name. It keeps its name; a later use of its session or id is a new agent's. */
  archive(agentId: AgentId): void {
    const agent = this.agent(agentId);
    if (agent == null || agent.name == null) throw new UserFacingError("Only an agent that has a name can be archived.");
    if (agent.archived) return;
    this.letIn.delete(agentId);
    this.asking.delete(agentId);
    for (const connection of this.connections.values()) connection.sessionless.delete(agentId);
    this.update(agentId, (kept) => ({ ...kept, archivedAt: now() }));
    // A session still connected is a new coding agent with no name from now on.
    const archived = this.stored.find(({ id }) => id === agentId);
    if (archived?.kind === "coding" && archived.session != null && [...this.connections.values()].some(({ session }) => session === archived.session)) {
      this.unnamedOfSession(archived.session);
      this.changed();
    }
    for (const listener of this.archivedListeners) listener(agentId);
  }

  /**
   * Restore an archived agent: it comes back with its name and its context,
   * and a coding agent with its session too unless another agent that is not
   * archived has that session, in which case it is known by its id from then
   * on. A restored coding agent whose session is connected now is asked
   * about, as when its session connects again. Its threads and the modules it
   * was the agent of are not given back.
   */
  restore(agentId: AgentId): void {
    const kept = this.stored.find(({ id }) => id === agentId);
    if (kept == null || kept.archivedAt == null) throw new UserFacingError("That agent is not archived.");
    if (kept.kind === "coding" && kept.session != null && this.namedOfSession(kept.session) != null) {
      this.update(agentId, (agent) => ({ ...agent, archivedAt: null, ...(agent.kind === "coding" ? { session: null } : {}) }));
      return;
    }
    this.update(agentId, (agent) => ({ ...agent, archivedAt: null }));
    if (kept.kind === "coding" && kept.session != null && this.unnamedSessions.has(kept.session)) {
      // The session's connection was a new coding agent with no name; it is this agent again.
      this.unnamedSessions.delete(kept.session);
      this.asking.add(agentId);
      this.changed();
    }
  }
}
