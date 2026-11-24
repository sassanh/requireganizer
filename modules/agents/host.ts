import { UserFacingError } from "lib/errors";
import { uuid } from "utilities";

import type { AgentToolDescription, WorkInterface } from "./interface";
import { InternalAgentRunner } from "./internal/runner";
import type { AgentId, ContextPart } from "./record";
import { type AgentCaller, type AgentNotice, AgentRegistry, NAME_TOOL, NAME_YOURSELF_TEXT, type Registration } from "./registry";
import type { SessionsSource } from "./sessions";
import { type TemplateDraft, templateProblems, type TemplatesSource } from "./templates";
import type { AgentsView } from "./view";

/** What a project host serves of the Agents module; the project protocol's host API extends it. */
export interface AgentsHostApi {
  /** The tools the agent this connection is can call on the project now. */
  listAgentTools(): Promise<AgentToolDescription[]>;
  /** Run one of those tools for the agent this connection is; resolves to its text result. */
  callAgentTool(name: string, args: Record<string, unknown>): Promise<string>;
  /** What an agent connecting is told of the project and its work. */
  agentInstructions(): string;
  /** This connection is a coding agent's, as its coding tool tells. The host then sends it the messages meant for its session. */
  registerAgent(registration: Registration): void;
  addTemplate(template: TemplateDraft): void;
  /** An empty key keeps the one the template has. */
  changeTemplate(templateId: string, template: TemplateDraft): void;
  removeTemplate(templateId: string): void;
  /** Start a new internal agent from a template, with a name or with none; resolves to its id. */
  startInternalAgent(templateId: string, name: string | null): AgentId;
  /** Name an internal agent, or a connected coding agent, that has no name. */
  nameAgent(agentId: AgentId, name: string): void;
  /** Archive an agent that has a name; refused while what the archiving concerns is not in `confirmed`, as the modules that guard archiving check. */
  archiveAgent(agentId: AgentId, confirmed?: string[]): void;
  /** Restore an archived agent. */
  restoreAgent(agentId: AgentId): void;
  /** Let a coding agent in, or refuse to. */
  answerLetIn(agentId: AgentId, letIn: boolean): void;
  /** An internal agent's context, oldest part first. */
  readContext(agentId: AgentId): ContextPart[];
}

/** What the Agents module needs of the project's session: which project is open, and a place beside it to keep the project's agents. */
export interface AgentsSession {
  /** The open project's id; null while none is open. */
  openProjectId(): string | null;
  /** What the module kept beside the open project; null for nothing. */
  keptBeside(key: "agents"): unknown;
  /** Keep the module's record beside the open project, apart from its history. */
  keepBeside(key: "agents", value: unknown): void;
}

/** What a host sends its clients of the Agents module. */
export type AgentsHostEvent =
  /** The agents and the templates, whole, whenever they change. */
  | { type: "agents"; view: AgentsView }
  /** To the connection of a coding agent only: a message meant for its session. */
  | { type: "agent-notice"; notice: AgentNotice };

/**
 * Checks an archiving before it is carried out, such as against the work the
 * agent has: throws to refuse it unless `confirmed` names what it concerns.
 */
/** What the spec owner must confirm before an action is carried out: a key they confirm it by, and what to tell them. */
export interface ConfirmationAsk {
  key: string;
  text: string;
}

/**
 * Checks an archiving before it is carried out; refuses it, asking for a
 * confirmation of what it concerns and of each of `asks`, while `confirmed`
 * does not name them all.
 */
export type ArchiveGuard = (agentId: AgentId, confirmed: readonly string[], asks: readonly ConfirmationAsk[]) => void;

/** The work interface while no module provides one: nothing but naming. */
const NO_WORK: WorkInterface = {
  tools: () => [],
  call: () => Promise.reject(new UserFacingError("The project offers no work to agents.")),
  instructions: () => "",
};

const AGENT_ID_PROPERTY = {
  type: "string",
  description: "The id the system gave you when you first named yourself; pass it with every call.",
};

/**
 * The Agents module as a project host holds it: the agents of the open
 * project, the templates, the internal agents' runs, and the agent interface
 * every agent reaches the project's work through, which lets an agent call
 * only once it may.
 */
export class AgentsHost {
  readonly registry: AgentRegistry;
  readonly runner: InternalAgentRunner;
  readonly api: Omit<AgentsHostApi, "listAgentTools" | "callAgentTool" | "registerAgent">;
  private work: WorkInterface = NO_WORK;
  private readonly guards = new Set<ArchiveGuard>();
  private sentView = "";
  private viewScheduled = false;
  private openProjectId: string | null = null;

  constructor(
    private readonly session: AgentsSession,
    templates: TemplatesSource,
    sessions: SessionsSource,
    /** Send the agents to every client. */
    private readonly broadcast: (view: AgentsView) => void,
  ) {
    this.registry = new AgentRegistry(templates, sessions, (record) => session.keepBeside("agents", record));
    this.runner = new InternalAgentRunner(this.registry);
    this.registry.subscribe(() => this.scheduleView());
    const { registry } = this;
    this.api = {
      agentInstructions: () => this.instructions(),
      addTemplate: (template) => {
        const problems = [...templateProblems(template), ...(template.key.trim().length === 0 ? ["Give the key for the endpoint."] : [])];
        if (problems.length > 0) throw new UserFacingError(problems.join("\n"));
        registry.addTemplate({ ...trimmed(template), id: uuid() });
      },
      changeTemplate: (templateId, template) => {
        const problems = templateProblems(template);
        if (problems.length > 0) throw new UserFacingError(problems.join("\n"));
        const current = registry.templates.read().find(({ id }) => id === templateId);
        if (current == null) throw new UserFacingError("That template was removed.");
        registry.changeTemplate({ ...trimmed(template), key: template.key.length === 0 ? current.key : template.key, id: templateId });
      },
      removeTemplate: (templateId) => registry.removeTemplate(templateId),
      startInternalAgent: (templateId, name) => {
        this.requireOpenProject();
        return registry.startInternal(templateId, name);
      },
      nameAgent: (agentId, name) => registry.nameBySpecOwner(agentId, name),
      archiveAgent: (agentId, confirmed = []) => {
        const asks: ConfirmationAsk[] = [{ key: `archive:${agentId}`, text: `${registry.label(agentId)} is taken out of use until you restore it: nothing can be assigned to it, and each thread it has is taken from it.` }];
        for (const guard of this.guards) guard(agentId, confirmed, asks);
        if (asks.some(({ key }) => !confirmed.includes(key))) throw new UserFacingError(asks.map(({ text }) => text).join(" "));
        registry.archive(agentId);
      },
      restoreAgent: (agentId) => registry.restore(agentId),
      answerLetIn: (agentId, letIn) => registry.answerLetIn(agentId, letIn),
      readContext: (agentId) => registry.context(agentId),
    };
  }

  /** Let a module provide the work agents do through the agent interface. */
  provideWork(work: WorkInterface): void {
    this.work = work;
  }

  /** Check each archiving, such as against the work the agent has; returns how to stop. */
  guardArchiving(guard: ArchiveGuard): () => void {
    this.guards.add(guard);
    return () => this.guards.delete(guard);
  }

  view(): AgentsView {
    return this.registry.view();
  }

  private requireOpenProject(): void {
    if (this.session.openProjectId() == null) throw new UserFacingError("Open a project first.");
  }

  private instructions(): string {
    return [
      `${NAME_YOURSELF_TEXT} The spec owner assigns you work by that name, and an agent keeps its name for good. Each time you name yourself, and each time your session connects again, the spec owner is asked whether to let you in; until they do, nothing but naming yourself is open to you.`,
      this.work.instructions(),
    ]
      .filter((part) => part.length > 0)
      .join(" ");
  }

  /** The tools a connection's agent can call: naming itself, then the project's work, each taking the agent's id for a sessionless coding agent. */
  listTools(connection: string): AgentToolDescription[] {
    const sessionless = this.registry.isSessionless(connection);
    const nameTool: AgentToolDescription = {
      name: NAME_TOOL,
      description: `Give yourself the name the spec owner assigns you work by. ${NAME_YOURSELF_TEXT} A name is refused when it is empty, when another agent has it, letters of either case counting as the same, even an agent not connected or archived, or when you already have a different name. Each time you name yourself, the spec owner is asked whether to let you in.${sessionless ? " Your coding tool tells the project no session, so the first time you name yourself you are given an id: pass it as agentId here and with every other call." : ""}`,
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, description: "Your name, such as the one your user calls you by." },
          ...(sessionless ? { agentId: { ...AGENT_ID_PROPERTY, description: "The id the system gave you when you first named yourself; leave it out only the first time." } } : {}),
        },
        required: ["name"],
        additionalProperties: false,
      },
    };
    const work = this.work.tools();
    if (!sessionless) return [nameTool, ...work];
    return [
      nameTool,
      ...work.map((tool) => {
        const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
        return { ...tool, inputSchema: { ...schema, properties: { ...schema.properties, agentId: AGENT_ID_PROPERTY }, required: [...(schema.required ?? []), "agentId"] } };
      }),
    ];
  }

  /** The tools an internal agent calls. */
  internalTools(): AgentToolDescription[] {
    return this.work.tools();
  }

  /**
   * Run a tool for an agent: naming itself for a coding agent, else the
   * project's work, once the agent calling is known and may call it.
   */
  async callTool(name: string, args: Record<string, unknown>, caller: AgentCaller): Promise<string> {
    if (name === NAME_TOOL) {
      if (!("connection" in caller)) throw new UserFacingError("Only a coding agent names itself.");
      if (typeof args.name !== "string") throw new UserFacingError("name must be a string.");
      const named = this.registry.nameSelf(caller.connection, args.name, args.agentId);
      const asked = "The spec owner is asked whether to let you in; until they do, nothing else is open to you.";
      return named.sessionless
        ? `You are “${args.name.trim()}”, and your id is ${named.agentId}: pass it as agentId with every call. ${asked}`
        : `You are “${args.name.trim()}”. ${asked}`;
    }
    const { agentId: givenId, ...rest } = args;
    const sessionless = "connection" in caller && this.registry.isSessionless(caller.connection);
    const agent = this.registry.caller(caller, sessionless ? givenId : undefined);
    return this.work.call(name, sessionless ? rest : args, agent);
  }

  /** A connection is a coding agent's, as its coding tool tells, told what is meant for its session through `tell`. */
  register(connection: string, registration: Registration, tell: (notice: AgentNotice) => void): void {
    this.registry.connect(connection, registration, tell);
  }

  /** A link to the host ended: the coding agent it was keeps its name and whatever it has. */
  connectionEnded(connection: string): void {
    this.registry.disconnect(connection);
  }

  /** The session changed: a project that opens brings its agents. */
  sessionChanged(): void {
    const projectId = this.session.openProjectId();
    if (projectId === this.openProjectId) return;
    this.openProjectId = projectId;
    this.runner.dispose();
    this.registry.load(projectId == null ? null : this.session.keptBeside("agents"));
  }

  close(): void {
    this.runner.dispose();
  }

  /** Send the agents once the change running now is made, when they changed. */
  private scheduleView(): void {
    if (this.viewScheduled) return;
    this.viewScheduled = true;
    queueMicrotask(() => {
      this.viewScheduled = false;
      const view = this.view();
      const sent = JSON.stringify(view);
      if (sent === this.sentView) return;
      this.sentView = sent;
      this.broadcast(view);
    });
  }
}

function trimmed(template: TemplateDraft): TemplateDraft {
  return { name: template.name.trim(), endpoint: template.endpoint.trim(), key: template.key.trim(), model: template.model.trim() };
}
