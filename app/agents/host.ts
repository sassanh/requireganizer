import { UserFacingError } from "lib/errors";
import { activeModule, visibleModuleNamed, visibleModules } from "lib/moduleSchema";
import type { ProjectSession } from "project-session";
import type { ModuleRegistry, ProjectState } from "storage";
import { SiblingModuleStores, type Store } from "store";
import type { ItemChange } from "workflow";

import { AgentDesk, type AgentNotice, type DeskView, type SpecOwnerAction } from "./desk";
import {
  type AgentCaller,
  agentToolChange,
  agentToolDescriptions,
  type AgentToolDescription,
  callAgentTool,
  type OpenModule,
  readToolDescriptions,
} from "./interface/tools";
import type { RunAgent, RunAgentsSource } from "./internal/runAgents";
import { RunAgentWorker } from "./internal/runner";
import { type RequestModule, reviewAskProblem, stageRequestKey, writeAskProblem } from "./requests";
import { type AgentId, AgentRoster, codingAgentId } from "./roster";
import { AGENTS_SECTION, type AgentsSection, parseAgentsSection, requestsOfModule, withModuleRequests } from "./section";

/** What a project host serves of the Agents module; the project protocol's host API extends it. */
export interface AgentsHostApi {
  /** The tools an agent can call on the open project now. */
  listAgentTools(): Promise<AgentToolDescription[]>;
  /** Run one of those tools for the agent this connection is; resolves to its text result. */
  callAgentTool(name: string, args: Record<string, unknown>, caller: AgentCaller): Promise<string>;
  /**
   * This connection is a coding agent, named `name` when no other available
   * agent has it, else unnamed until it names itself. The host then tells it
   * of each request given to it or stopped.
   */
  registerAgent(name: string | null): { agentId: AgentId; name: string | null };
  /** Name a connected coding agent that has no name. */
  nameCodingAgent(agentId: AgentId, name: string): void;
  addRunAgent(agent: Omit<RunAgent, "id">): void;
  /** An empty API key keeps the one the agent has. */
  changeRunAgent(agentId: AgentId, agent: Omit<RunAgent, "id">): void;
  removeRunAgent(agentId: AgentId): void;
  /** Give a waiting request no agent has to an available agent; refused while it concerns requests other agents have that `stopping` does not name. */
  giveRequest(key: string, agentId: AgentId, stopping?: string[]): void;
  /** Take requests back from the agents that have them. */
  stopRequests(keys: string[]): void;
  /**
   * Ask for a stage of a module to be written, or reviewed, and give the
   * request to `agentId`, or to none; refused while giving it concerns
   * requests other agents have that `stopping` does not name.
   */
  askToWrite(moduleId: string, stage: string, agentId: AgentId | null, stopping?: string[]): void;
  askToReview(moduleId: string, stage: string, agentId: AgentId | null, stopping?: string[]): void;
  /** Withdraw a waiting request no agent has. */
  withdrawRequest(key: string): void;
}

/** What a host sends its clients of the Agents module. */
export type AgentsHostEvent =
  /** The agents and the waiting requests, whole, whenever they change. */
  | { type: "agents"; view: DeskView }
  /** To the connection that is the agent only: a request given to it or stopped. */
  | { type: "agent-notice"; notice: AgentNotice };

/** An action of the spec owner's that shows another state of the project, as the session tells what it would leave. */
export type ReplacingAction = Parameters<ProjectSession["stateAfter"]>[0];

/** The open project's visible modules as requests are read from them: the shown one's live store, each other's as the session reads it. */
export function requestModules(registry: ModuleRegistry | null, shown: Store | null, storeOf: (moduleId: string) => Store | null): RequestModule[] {
  if (registry == null || shown == null) return [];
  const section = parseAgentsSection(registry.sections[AGENTS_SECTION]);
  return visibleModules(registry).flatMap((entry): RequestModule[] => {
    const store = entry.id === registry.activeModuleId ? shown : storeOf(entry.id);
    return store == null ? [] : [{ id: entry.id, name: registry.modulesEnabled ? entry.name : null, store, requests: requestsOfModule(section, entry.id) }];
  });
}

/** The modules of a state of the project, such as one undo would bring back, as requests are read from them. */
export function requestModulesOfState(state: ProjectState): RequestModule[] {
  const stores = new SiblingModuleStores();
  stores.linkState(state);
  const section = parseAgentsSection(state.sections[AGENTS_SECTION]);
  return visibleModules(state).flatMap((entry): RequestModule[] => {
    const store = stores.storeOf(entry.id);
    return store == null ? [] : [{ id: entry.id, name: state.modulesEnabled ? entry.name : null, store, requests: requestsOfModule(section, entry.id) }];
  });
}

/**
 * A store action of the spec owner's as the requests agents have may
 * concern it; null for one that concerns none, such as a signature.
 */
function storeAction(store: Store, moduleId: string, name: string, args: readonly unknown[]): SpecOwnerAction | null {
  const stageOfItem = (id: unknown) => (typeof id === "string" ? (store.locate(id)?.stage ?? null) : null);
  switch (name) {
    case "writeItems": {
      const changes = (args[0] ?? []) as ItemChange[];
      const stages = [...new Set(changes.flatMap((change) => {
        const stage = change.type === "add" ? change.stage : stageOfItem(change.item);
        return stage == null ? [] : [stage];
      }))];
      return { kind: "change items", moduleId, stages };
    }
    case "restoreSigned": {
      const stage = stageOfItem(args[0]);
      return stage == null ? null : { kind: "change items", moduleId, stages: [stage] };
    }
    case "resolveThread":
      return typeof args[0] === "string" ? { kind: "resolve thread", moduleId, threadId: args[0] } : null;
    // A message the spec owner sends makes its thread's change request anew, given to no agent.
    case "replyAsSpecOwner":
      return typeof args[0] === "string" ? { kind: "send message", moduleId, threadId: args[0], to: null } : null;
    case "requestChange": {
      const thread = typeof args[0] === "string" ? store.openThreadOf(args[0]) : null;
      return thread == null ? null : { kind: "send message", moduleId, threadId: thread.id, to: null };
    }
    default:
      return null;
  }
}

/**
 * The Agents module as a project host holds it: the agents and the
 * requests they have, the agent interface on the host's session, and the
 * gates every action of the spec owner's that concerns those requests goes
 * through. The host tells it of connections, of session and store changes,
 * and asks it before each such action.
 */
export class AgentsHost {
  readonly roster: AgentRoster;
  readonly desk: AgentDesk;
  readonly api: AgentsHostApi;
  private readonly stopWorker: () => void;
  /** How each connection that is a coding agent is told of its requests. */
  private readonly tellers = new Map<AgentId, (notice: AgentNotice) => void>();
  private sentView = "";
  private viewScheduled = false;
  /** The project open when the session last changed, so that opening one is told apart. */
  private openProjectId: string | null = null;

  constructor(
    private readonly session: ProjectSession,
    runAgents: RunAgentsSource,
    /** Send the agents and waiting requests to every client. */
    private readonly broadcast: (view: DeskView) => void,
  ) {
    this.roster = new AgentRoster(runAgents);
    this.desk = new AgentDesk(this.roster, () => {
      const snapshot = session.getSnapshot();
      return snapshot.status === "ready" ? requestModules(snapshot.registry, snapshot.store, session.otherModuleStore) : [];
    });
    this.desk.subscribe(() => this.scheduleView());
    this.desk.subscribeNotices((agentId, notice) => this.tellers.get(agentId)?.(notice));
    const desk = this.desk;
    this.api = {
      listAgentTools: async () => {
        // Without an open project the read tools are still listed: calling one tells the agent what stands in the way.
        const store = await this.openStore().catch(() => null);
        return store == null ? readToolDescriptions() : agentToolDescriptions(this.openModule());
      },
      callAgentTool: async (name, args, caller) => {
        const store = await this.openStore();
        // One call is one change, though a write with answers takes two store
        // actions. Reading goes through the gate too: while an outside change
        // waits, either version may be the one kept, so neither is read.
        const open = this.openModule(caller);
        const makes = agentToolChange(name, open);
        const run = () => callAgentTool(store, name, args, open, caller);
        return makes == null ? session.read(run) : session.change(makes, run, { agent: this.agentName(caller) });
      },
      registerAgent: () => {
        throw new Error("registerAgent is answered for its connection.");
      },
      nameCodingAgent: (agentId, name) => {
        const connection = this.roster.connectionOf(agentId);
        if (connection == null) throw new UserFacingError("That coding agent is no longer connected.");
        this.roster.nameCodingAgent(connection, name);
      },
      addRunAgent: (agent) => void this.roster.addRunAgent(agent),
      changeRunAgent: (agentId, agent) => this.roster.changeRunAgent(agentId, agent),
      removeRunAgent: (agentId) => this.roster.removeRunAgent(agentId),
      giveRequest: (key, agentId, stopping) => {
        desk.clear({ kind: "give", key, agentId }, stopping);
        desk.give(key, agentId);
      },
      stopRequests: (keys) => desk.stopAll(keys),
      askToWrite: (moduleId, stage, agentId, stopping) => this.ask("write", moduleId, stage, agentId, stopping),
      askToReview: (moduleId, stage, agentId, stopping) => this.ask("review", moduleId, stage, agentId, stopping),
      withdrawRequest: (key) => {
        const request = desk.requireWithdrawable(key);
        const summary = desk.summary(request);
        this.changeSection(`Withdrew: ${summary}`, (section) =>
          withModuleRequests(section, request.moduleId, (requests) => {
            switch (request.kind) {
              case "write":
                return { ...requests, write: requests.write.filter(({ stage }) => stage !== request.stage) };
              case "review":
                return { ...requests, review: requests.review.filter(({ stage }) => stage !== request.stage) };
              case "change": {
                const { thread } = request;
                const note = { threadId: thread!.id, message: thread!.message, at: new Date().toISOString() };
                return { ...requests, withdrawn: [...requests.withdrawn, note] };
              }
            }
          }),
        );
      },
    };
    // An agent Requireganizer runs calls the same tools a coding agent does, as itself.
    this.stopWorker = new RunAgentWorker(this.desk, {
      list: async () => agentToolDescriptions(this.openModule()),
      call: (agentId, name, args) => this.api.callAgentTool(name, args, { name: "", agentId }),
    }).start();
  }

  /** A module of the open project as requests are read from it. */
  private requestModule(moduleId: string): RequestModule {
    const snapshot = this.session.getSnapshot();
    const found = (snapshot.status === "ready" ? requestModules(snapshot.registry, snapshot.store, this.session.otherModuleStore) : []).find(({ id }) => id === moduleId);
    if (found == null) throw new UserFacingError("That module is no longer open.");
    return found;
  }

  /** Change the Agents module's section of the project, as one step the spec owner or an agent makes. */
  private changeSection(description: string, update: (section: AgentsSection) => AgentsSection, author: "spec owner" | { agent: string } = "spec owner"): void {
    this.session.changeSection(AGENTS_SECTION, description, (value) => update(parseAgentsSection(value)), author);
  }

  /** Make a request to write or to review a stage, and give it to `agentId`, or to none. */
  private ask(kind: "write" | "review", moduleId: string, stage: string, agentId: AgentId | null, stopping: readonly string[] | undefined): void {
    const { store, requests } = this.requestModule(moduleId);
    if (!store.workflow.isStage(stage)) throw new UserFacingError(`There is no stage ${stage}.`);
    const problem = kind === "write" ? writeAskProblem(store, requests, stage) : reviewAskProblem(store, requests, stage);
    if (problem != null) throw new UserFacingError(problem);
    if (agentId != null) this.desk.clear({ kind: "make", moduleId, stage, agentId }, stopping);
    const at = new Date().toISOString();
    const label = store.workflow.stage(stage).label;
    this.changeSection(kind === "write" ? `Asked for the writing of ${label}` : `Asked for a review of ${label}`, (section) =>
      withModuleRequests(section, moduleId, (current) => ({ ...current, [kind]: [...current[kind], { stage, at }] })),
    );
    if (agentId != null) this.desk.give(stageRequestKey(kind, moduleId, { stage, at }), agentId);
  }

  /** The agents and the waiting requests as clients see them. */
  view(): DeskView {
    return this.desk.view();
  }

  /** A connection is a coding agent, named `name` when no other available agent has it, told of its requests through `tell`. */
  register(connection: string, tell: (notice: AgentNotice) => void, name: string | null): { agentId: AgentId; name: string | null } {
    this.roster.connect(connection);
    const agentId = codingAgentId(connection);
    this.tellers.set(agentId, tell);
    if (name != null && this.roster.nameOf(agentId) == null && this.roster.nameProblem(name, agentId) == null) this.roster.nameCodingAgent(connection, name);
    return { agentId, name: this.roster.nameOf(agentId) };
  }

  /** A link to the host ended: the coding agent it was, if any, is no longer available, so no request is its. */
  connectionEnded(connection: string): void {
    this.tellers.delete(codingAgentId(connection));
    this.roster.disconnect(connection);
  }

  /** The session changed: a project that opens has every request no agent's; any other change lets go of what no longer waits. */
  sessionChanged(): void {
    const snapshot = this.session.getSnapshot();
    const projectId = snapshot.status === "ready" ? snapshot.activeProject.id : null;
    if (projectId !== this.openProjectId) {
      this.openProjectId = projectId;
      this.desk.forget();
    } else {
      this.desk.settle();
    }
    this.scheduleView();
  }

  /** The shown store changed: what waits may have changed with it. */
  storeChanged(): void {
    this.scheduleView();
  }

  /** Refuse a store action of the spec owner's while it concerns requests agents have that `stopping` does not name; stop those it names. */
  clearStoreAction(store: Store, name: string, args: readonly unknown[], stopping: readonly string[] | undefined): void {
    const moduleId = this.session.getSnapshot().registry?.activeModuleId;
    const action = moduleId == null ? null : storeAction(store, moduleId, name, args);
    if (action != null) this.desk.clear(action, stopping);
  }

  /**
   * Refuse an action of the spec owner's that shows another state of the
   * project, such as undo or an import, while it concerns requests agents
   * have that `stopping` does not name; stop those it names.
   */
  async clearReplacing(action: ReplacingAction, stopping: readonly string[] | undefined): Promise<void> {
    const after = await this.session.stateAfter(action);
    if (after != null) this.desk.clear({ kind: "move in history", after: requestModulesOfState(after) }, stopping);
  }

  close(): void {
    this.stopWorker();
  }

  /** Send the agents and waiting requests once the change running now is made, when they changed. */
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

  /** The name an agent's messages and pointers are signed with: the one the roster knows it by. */
  private agentName(caller: AgentCaller): string {
    const id = caller.agentId ?? (caller.connection == null ? null : codingAgentId(caller.connection));
    return (id == null ? null : this.roster.nameOf(id)) ?? caller.name;
  }

  /**
   * What an agent works on: the module the page shows, every other module by
   * its name, read or changed without showing it, and the requests agents
   * have. Nothing an agent does moves the spec owner's page.
   */
  private openModule(caller: AgentCaller = { name: "The coding agent" }): OpenModule {
    const snapshot = this.session.getSnapshot();
    const { registry } = snapshot;
    if (registry == null) return {};
    const pointOut: OpenModule["pointOut"] = (units, text) => {
      const places = units.map((unit) => {
        const moduleId = unit.module == null ? registry.activeModuleId : visibleModuleNamed(registry, unit.module)?.id;
        if (moduleId == null) throw new UserFacingError(`There is no module named “${unit.module}”.`);
        return { moduleId, stage: unit.stage, unitId: unit.unitId };
      });
      this.session.pointOut(places, text, this.agentName(caller));
    };
    const author = { agent: this.agentName(caller) };
    const agents: OpenModule = {
      desk: this.desk,
      moduleId: registry.activeModuleId,
      fulfilWriting: (moduleId, stage) => {
        const label = this.requestModule(moduleId).store.workflow.stage(stage).label;
        const at = new Date().toISOString();
        this.changeSection(
          `Fulfilled the request to write ${label}`,
          (section) =>
            withModuleRequests(section, moduleId, (requests) => ({
              ...requests,
              write: requests.write.filter((ask) => ask.stage !== stage),
              fulfilled: [...requests.fulfilled.filter((done) => done.stage !== stage), { stage, at }],
            })),
          author,
        );
      },
      answerReview: (moduleId, stage, findings) => {
        const { store } = this.requestModule(moduleId);
        const found = findings.map(({ itemId, rule, how }) => ({ itemId, stage, revision: store.itemState(itemId)!.revision, rule, how }));
        this.changeSection(
          `Answered the request to review ${store.workflow.stage(stage).label}`,
          (section) =>
            withModuleRequests(section, moduleId, (requests) => ({
              ...requests,
              review: requests.review.filter((ask) => ask.stage !== stage),
              findings: [...requests.findings.filter((finding) => finding.stage !== stage), ...found],
            })),
          author,
        );
      },
    };
    if (!registry.modulesEnabled) return { pointOut, ...agents };
    const moduleName = activeModule(registry)?.name;
    if (moduleName == null) return { pointOut, ...agents };
    const modules = visibleModules(registry);
    const moduleNamed = (name: string) => {
      const target = visibleModuleNamed(registry, name);
      if (target != null) return target;
      const names = modules.map((entry) => `“${entry.name}”`).join(", ");
      throw new UserFacingError(`There is no module named “${name}”. The modules are ${names}.`);
    };
    return {
      moduleName,
      ...(modules.length > 1
        ? {
            otherModule: (name: string) => {
              const target = moduleNamed(name);
              const store = target.id === registry.activeModuleId ? snapshot.store : this.session.otherModuleStore(target.id);
              if (store == null) throw new UserFacingError(`“${target.name}” could not be read.`);
              return {
                id: target.id,
                name: target.name,
                store,
                change: <Result>(run: (changed: Store) => Result): Result => this.session.changeOtherModule(target.id, run),
              };
            },
          }
        : {}),
      addModule: (name) => this.session.addModule(name, { show: false }),
      pointOut,
      ...agents,
    };
  }

  /** The open project's shown store, opening the only project a single-project storage holds. */
  private async openStore(): Promise<Store> {
    await this.session.openOnlyProject();
    const snapshot = this.session.getSnapshot();
    switch (snapshot.status) {
      case "ready":
        return snapshot.store;
      case "failed":
        throw new UserFacingError(snapshot.persistenceError);
      case "loading":
        throw new UserFacingError("The project is still opening. Try again in a moment.");
      case "elsewhere":
        throw new UserFacingError("The project is open in another tab. Ask the person to take it over in Requireganizer.");
      case "idle":
        throw new UserFacingError(
          this.session.persistence.traits.singleProject
            ? `${this.session.persistence.traits.name} holds no project yet. Ask the person to create it in Requireganizer, then call get_workflow_state.`
            : "Ask the person to open a project in Requireganizer, then call get_workflow_state.",
        );
    }
  }
}
