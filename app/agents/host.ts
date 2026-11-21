import { UserFacingError } from "lib/errors";
import { activeModule, visibleModuleNamed, visibleModules } from "lib/moduleSchema";
import type { ProjectSession } from "project-session";
import type { ModuleRegistry, ProjectState } from "storage";
import { SiblingModuleStores, type Store } from "store";
import type { ItemChange } from "workflow";

import { asksAnnotation } from "./annotations";
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
import type { RunLog } from "./record";
import { type AgentId, AgentRoster, codingAgentId } from "./roster";
import { askText, type ProjectModule, reviewAskProblem, writeAskProblem } from "./waiting";

/** What a project host serves of the Agents module; the project protocol's host API extends it. */
export interface AgentsHostApi {
  /** The tools an agent can call on the open project now. */
  listAgentTools(): Promise<AgentToolDescription[]>;
  /** Run one of those tools for the agent this connection is; resolves to its text result. */
  callAgentTool(name: string, args: Record<string, unknown>, caller: AgentCaller): Promise<string>;
  /**
   * This connection is a coding agent, named `name` when no other available
   * agent has it, else unnamed until it names itself. The host then tells it
   * of each thread assigned to it and of each time it is stopped.
   */
  registerAgent(name: string | null): { agentId: AgentId; name: string | null };
  /** Name a connected coding agent that has no name. */
  nameCodingAgent(agentId: AgentId, name: string): void;
  addRunAgent(agent: Omit<RunAgent, "id">): void;
  /** An empty API key keeps the one the agent has. */
  changeRunAgent(agentId: AgentId, agent: Omit<RunAgent, "id">): void;
  removeRunAgent(agentId: AgentId): void;
  /** Assign a waiting thread no agent has to an available agent; refused while it concerns threads other agents have that `stopping` does not name. */
  assignThread(key: string, agentId: AgentId, stopping?: string[]): void;
  /** Stop the agents working on these waiting threads. */
  stopAgents(keys: string[]): void;
  /**
   * Ask for a stage of a module to be written, or reviewed, in a thread of
   * its own on the stage, assigned to `agentId`, or to none; refused while
   * assigning it concerns threads other agents have that `stopping` does
   * not name.
   */
  askToWrite(moduleId: string, stage: string, agentId: AgentId | null, stopping?: string[]): void;
  askToReview(moduleId: string, stage: string, agentId: AgentId | null, stopping?: string[]): void;
  /** Withdraw a waiting thread no agent has from waiting. */
  withdrawThread(key: string): void;
  /** The run logs kept with a wait, oldest first. */
  readRunLogs(key: string): RunLog[];
}

/** What a host sends its clients of the Agents module. */
export type AgentsHostEvent =
  /** The agents, the threads waiting for an agent and what threads and items show of them, whole, whenever they change. */
  | { type: "agents"; view: DeskView }
  /** To the connection that is the agent only: a thread assigned to it, or it stopped working on one. */
  | { type: "agent-notice"; notice: AgentNotice };

/** An action of the spec owner's that shows another state of the project, as the session tells what it would leave. */
export type ReplacingAction = Parameters<ProjectSession["stateAfter"]>[0];

/** The open project's visible modules as waiting threads are read from them: the shown one's live store, each other's as the session reads it. */
export function projectModules(registry: ModuleRegistry | null, shown: Store | null, storeOf: (moduleId: string) => Store | null): ProjectModule[] {
  if (registry == null || shown == null) return [];
  return visibleModules(registry).flatMap((entry): ProjectModule[] => {
    const store = entry.id === registry.activeModuleId ? shown : storeOf(entry.id);
    return store == null ? [] : [{ id: entry.id, name: registry.modulesEnabled ? entry.name : null, store }];
  });
}

/** The modules of a state of the project, such as one undo would bring back, as waiting threads are read from them. */
export function projectModulesOfState(state: ProjectState): ProjectModule[] {
  const stores = new SiblingModuleStores();
  stores.linkState(state);
  return visibleModules(state).flatMap((entry): ProjectModule[] => {
    const store = stores.storeOf(entry.id);
    return store == null ? [] : [{ id: entry.id, name: state.modulesEnabled ? entry.name : null, store }];
  });
}

/**
 * A store action of the spec owner's as the threads agents have may concern
 * it, a message assigned to `assignTo`; null for one that concerns none,
 * such as a signature.
 */
function storeAction(store: Store, moduleId: string, name: string, args: readonly unknown[], assignTo: AgentId | null): SpecOwnerAction | null {
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
    // A message the spec owner sends sets its thread waiting anew, assigned to `assignTo` or to none.
    case "replyAsSpecOwner": {
      const thread = typeof args[0] === "string" ? store.threads.find(({ id }) => id === args[0]) : undefined;
      return thread == null ? null : { kind: "send message", moduleId, stage: thread.stage, unitId: thread.unitId, threadId: thread.id, to: assignTo };
    }
    case "messageUnit": {
      const unitId = typeof args[0] === "string" ? args[0] : null;
      const stage = unitId == null ? null : store.unitState(unitId)?.stage;
      return unitId == null || stage == null ? null : { kind: "send message", moduleId, stage, unitId, threadId: store.openThreadOf(unitId)?.id ?? null, to: assignTo };
    }
    case "openStageThread":
      return typeof args[0] === "string" ? { kind: "send message", moduleId, stage: args[0], unitId: null, threadId: null, to: assignTo } : null;
    default:
      return null;
  }
}

/**
 * The Agents module as a project host holds it: the agents and the threads
 * they have, the agent interface on the host's session, and the gates every
 * action of the spec owner's that concerns those threads goes through. The
 * host tells it of connections, of session and store changes, and asks it
 * before each such action.
 */
export class AgentsHost {
  readonly roster: AgentRoster;
  readonly desk: AgentDesk;
  readonly api: AgentsHostApi;
  private readonly stopWorker: () => void;
  /** How each connection that is a coding agent is told of its threads. */
  private readonly tellers = new Map<AgentId, (notice: AgentNotice) => void>();
  private sentView = "";
  private viewScheduled = false;
  /** The project open when the session last changed, so that opening one is told apart. */
  private openProjectId: string | null = null;

  constructor(
    private readonly session: ProjectSession,
    runAgents: RunAgentsSource,
    /** Send the agents and the threads waiting for an agent to every client. */
    private readonly broadcast: (view: DeskView) => void,
  ) {
    this.roster = new AgentRoster(runAgents);
    this.desk = new AgentDesk(
      this.roster,
      () => {
        const snapshot = session.getSnapshot();
        return snapshot.status === "ready" ? projectModules(snapshot.registry, snapshot.store, session.otherModuleStore) : [];
      },
      (records) => session.keepAgentWaits(records),
    );
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
      assignThread: (key, agentId, stopping) => {
        desk.clear({ kind: "assign", key, agentId }, stopping);
        desk.assign(key, agentId);
      },
      stopAgents: (keys) => desk.stopAll(keys),
      askToWrite: (moduleId, stage, agentId, stopping) => this.ask("write", moduleId, stage, agentId, stopping),
      askToReview: (moduleId, stage, agentId, stopping) => this.ask("review", moduleId, stage, agentId, stopping),
      withdrawThread: (key) => desk.withdraw(key),
      readRunLogs: (key) => desk.runLogs(key),
    };
    // An agent Requireganizer runs calls the same tools a coding agent does, as itself.
    this.stopWorker = new RunAgentWorker(this.desk, {
      list: async () => agentToolDescriptions(this.openModule()),
      call: (agentId, name, args) => this.api.callAgentTool(name, args, { name: "", agentId }),
    }).start();
  }

  /** A module of the open project as waiting threads are read from it. */
  private projectModule(moduleId: string): ProjectModule {
    const snapshot = this.session.getSnapshot();
    const found = (snapshot.status === "ready" ? projectModules(snapshot.registry, snapshot.store, this.session.otherModuleStore) : []).find(({ id }) => id === moduleId);
    if (found == null) throw new UserFacingError("That module is no longer open.");
    return found;
  }

  /** Ask for a stage to be written or reviewed, in a thread of its own on that stage, assigned to `agentId`, or to none. */
  private ask(kind: "write" | "review", moduleId: string, stage: string, agentId: AgentId | null, stopping: readonly string[] | undefined): void {
    const asked = this.projectModule(moduleId);
    const { store } = asked;
    if (!store.workflow.isStage(stage)) throw new UserFacingError(`There is no stage ${stage}.`);
    const records = this.desk.waitRecords();
    const problem = kind === "write" ? writeAskProblem(asked, records, stage) : reviewAskProblem(asked, records, stage);
    if (problem != null) throw new UserFacingError(problem);
    const label = store.workflow.stage(stage).label;
    const args = [stage, askText(kind, label), asksAnnotation(kind)] as const;
    this.clearSpecOwnerAction({ kind: "send message", moduleId, stage, unitId: null, threadId: null, to: agentId }, stopping);
    const active = this.session.getSnapshot().registry?.activeModuleId;
    const threadId = this.session.change(
      "thread message",
      () => (moduleId === active ? store.openStageThread(...args) : this.session.changeOtherModule(moduleId, (other) => other.openStageThread(...args))),
      "spec owner",
      undefined,
      kind === "write" ? `Asked for the writing of ${label}` : `Asked for a review of ${label}`,
    );
    this.setWaiting(moduleId, threadId, agentId);
  }

  /**
   * Refuse an action of the spec owner's while it concerns threads agents
   * have that `stopping` does not name, or while it assigns a thread to an
   * agent it cannot be assigned to; stop the agents `stopping` names.
   */
  private clearSpecOwnerAction(action: SpecOwnerAction, stopping: readonly string[] | undefined): void {
    if (action.kind === "send message" && action.to != null) this.desk.requireAssignable(action.moduleId, action.stage, action.to);
    this.desk.clear(action, stopping);
  }

  /**
   * The spec owner's message, the last of a thread, set it waiting for an
   * agent: what waited in the thread before ends, and the thread is
   * assigned to `to`, if any.
   */
  private setWaiting(moduleId: string, threadId: string, to: AgentId | null): void {
    const { store } = this.projectModule(moduleId);
    const message = store.threads.find(({ id }) => id === threadId)?.messages.at(-1);
    if (message == null) return;
    const key = this.desk.setWaiting(moduleId, threadId, message.id);
    this.desk.settle();
    if (to != null) this.desk.assign(key, to);
  }

  /** The agents and the threads waiting for an agent as clients see them. */
  view(): DeskView {
    return this.desk.view();
  }

  /** A connection is a coding agent, named `name` when no other available agent has it, told of its threads through `tell`. */
  register(connection: string, tell: (notice: AgentNotice) => void, name: string | null): { agentId: AgentId; name: string | null } {
    this.roster.connect(connection);
    const agentId = codingAgentId(connection);
    this.tellers.set(agentId, tell);
    if (name != null && this.roster.nameOf(agentId) == null && this.roster.nameProblem(name, agentId) == null) this.roster.nameCodingAgent(connection, name);
    return { agentId, name: this.roster.nameOf(agentId) };
  }

  /** A link to the host ended: the coding agent it was, if any, is no longer available, so no thread is its. */
  connectionEnded(connection: string): void {
    this.tellers.delete(codingAgentId(connection));
    this.roster.disconnect(connection);
  }

  /** The session changed: a project that opens has every waiting thread no agent's; any other change lets go of what no longer waits. */
  sessionChanged(): void {
    const snapshot = this.session.getSnapshot();
    const projectId = snapshot.status === "ready" ? snapshot.activeProject.id : null;
    if (projectId !== this.openProjectId) {
      this.openProjectId = projectId;
      this.desk.load(projectId == null ? null : this.session.agentWaits());
    } else {
      this.desk.settle();
    }
    this.scheduleView();
  }

  /** The shown store changed: what waits may have changed with it. */
  storeChanged(): void {
    this.scheduleView();
  }

  /**
   * Refuse a store action of the spec owner's while it concerns threads
   * agents have that `stopping` does not name, or while it would assign its
   * thread to an agent it cannot be assigned to; stop the agents `stopping`
   * names.
   */
  clearStoreAction(store: Store, name: string, args: readonly unknown[], stopping: readonly string[] | undefined, assignTo: AgentId | null): void {
    const moduleId = this.session.getSnapshot().registry?.activeModuleId;
    const action = moduleId == null ? null : storeAction(store, moduleId, name, args, assignTo);
    if (action != null) this.clearSpecOwnerAction(action, stopping);
  }

  /** A store action of the spec owner's was carried out: a message of theirs set its thread waiting, assigned to `assignTo`, if any. */
  storeActionDone(store: Store, name: string, args: readonly unknown[], result: unknown, assignTo: AgentId | null): void {
    const moduleId = this.session.getSnapshot().registry?.activeModuleId;
    if (moduleId == null) return;
    const threadId = name === "replyAsSpecOwner" ? args[0] : name === "messageUnit" || name === "openStageThread" ? result : null;
    if (typeof threadId === "string" && store.threads.some(({ id }) => id === threadId)) this.setWaiting(moduleId, threadId, assignTo);
  }

  /**
   * Refuse an action of the spec owner's that shows another state of the
   * project, such as undo or an import, while it concerns threads agents
   * have that `stopping` does not name; stop the agents it names.
   */
  async clearReplacing(action: ReplacingAction, stopping: readonly string[] | undefined): Promise<void> {
    const after = await this.session.stateAfter(action);
    if (after != null) this.desk.clear({ kind: "move in history", after: projectModulesOfState(after) }, stopping);
  }

  close(): void {
    this.stopWorker();
  }

  /** Send the agents and the threads waiting for an agent once the change running now is made, when they changed. */
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
   * its name, read or changed without showing it, and the threads agents
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
    const agents: OpenModule = { desk: this.desk, moduleId: registry.activeModuleId };
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
