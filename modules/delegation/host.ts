import type { AgentId, AgentsHost, AgentView, CallingAgent } from "agents";
import { UserFacingError } from "lib/errors";
import { activeModule, SiblingModuleStores, visibleModuleNamed, visibleModules } from "modules";
import type { ProjectSession } from "project-session";
import type { ModuleRegistry, ProjectState } from "storage";
import type { Store } from "store";
import { type ItemChange, revisionOf } from "workflow";

import { asksAnnotation, findingsOf, replyAgent } from "./annotations";
import { type TakeContext, whyCannotTake } from "./availability";
import { type ConfirmationNote, ConfirmationNeededError, Desk, type SpecOwnerAction, type WaitingThreadState } from "./desk";
import { replyRulesText } from "./interface/replyRules";
import { agentToolChange, agentToolDescriptions, callAgentTool, type WorkScope } from "./interface/tools";
import { type Failure, type ReplyChange, type ThreadPlace, threadKey } from "./record";
import {
  askText,
  assignmentPrompt,
  type HeldThread,
  type ProjectModule,
  reviewAskProblem,
  stagesToUpdateAfter,
  updateAskProblem,
} from "./waiting";

/** Whom a thread is assigned to as the spec owner sends a message in it or asks for a stage: an agent, or a new internal agent started from a template. */
export type AssignTarget = { agent: AgentId } | { template: string };

/** How long a request to an internal agent's AI provider may go without anything returned before the agent fails the thread. */
const INTERNAL_REQUEST_TIMEOUT_MS = 5 * 60_000;

/** What Delegation serves a project host's clients; the project protocol's host API extends it. */
export interface DelegationHostApi {
  /** Assign a thread waiting for an agent that no agent has; refused while what it concerns is not in `confirmed`. */
  assignThread(key: string, target: AssignTarget, confirmed?: string[]): void;
  /** Stop the agents working on these waiting threads. */
  stopAgents(keys: string[]): void;
  /** Ask the agent that has a waiting thread to continue its work on it. */
  continueThread(key: string): void;
  /** Withdraw a waiting thread no agent has from waiting. */
  withdrawThread(key: string): void;
  /** Ask for stages of a module to be updated, each in a thread of its own, assigned to `target` or to none. */
  askToUpdate(moduleId: string, stages: string[], target: AssignTarget | null, confirmed?: string[]): void;
  /** Ask for a stage of a module to be reviewed, in a thread of its own, assigned to `target` or to none. */
  askToReview(moduleId: string, stage: string, target: AssignTarget | null, confirmed?: string[]): void;
  /** Set or clear the agent of a module. */
  setModuleAgent(moduleId: string, agentId: AgentId | null): void;
  /** The item changes a reply made. */
  readReplyChanges(messageId: string): ReplyChange[];
}

/** A finding a reply gives, with the reply's thread and module, the agent that gave it and when. */
export interface FindingView {
  moduleId: string;
  threadId: string;
  messageId: string;
  /** The agent that gave it; null for a reply Delegation did not annotate. */
  agentId: AgentId | null;
  /** The name the reply was written with. */
  writtenBy: string;
  at: string | null;
  itemId: string;
  revision: string;
  rule: string;
  how: string;
  /** The agent that gave it wrote the item's current version. */
  ownWork: boolean;
}

/** What the spec owner may ask of a stage now: its update, its review, and in one step the update of the stages building on it. */
export interface StageAsks {
  moduleId: string;
  stage: string;
  update: boolean;
  review: boolean;
  updateAfter: string[];
}

/** A waiting thread as the page sees it, with why its agent cannot be asked to continue, if it cannot. */
export type WaitingView = WaitingThreadState & { continueProblem: string | null };

/** What the page shows of Delegation. */
export interface DelegationView {
  waiting: WaitingView[];
  /** Each wait the spec owner withdrew, by the message that set it waiting. */
  withdrawn: { moduleId: string; threadId: string; messageId: string; at: string }[];
  findings: FindingView[];
  asks: StageAsks[];
  moduleAgents: Record<string, AgentId>;
  /** By thread key. */
  failures: Record<string, Failure>;
  /** The agents each thread was assigned to, oldest first, by thread key. */
  threadAgents: Record<string, AgentId[]>;
  startedIn: Record<AgentId, ThreadPlace>;
}

export const EMPTY_DELEGATION_VIEW: DelegationView = { waiting: [], withdrawn: [], findings: [], asks: [], moduleAgents: {}, failures: {}, threadAgents: {}, startedIn: {} };

/** What a host sends its clients of Delegation. */
export type DelegationHostEvent = { type: "delegation"; view: DelegationView };

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

/** The modules of a state of the project, such as one undo would bring back. */
function projectModulesOfState(state: ProjectState): ProjectModule[] {
  const stores = new SiblingModuleStores();
  stores.linkState(state);
  return visibleModules(state).flatMap((entry): ProjectModule[] => {
    const store = stores.storeOf(entry.id);
    return store == null ? [] : [{ id: entry.id, name: state.modulesEnabled ? entry.name : null, store }];
  });
}

/** A target that names no agent yet: a new internal agent, which no thread has. */
const NEW_AGENT = "a new internal agent";

/** The instructions every agent gets of the work on the spec. */
function workInstructions(): string {
  return `Requireganizer holds the spec the spec owner signs for this project, stage by stage, each item traced to what it builds on. Read it before building: get_workflow_state shows which stages are open; get_stage_rules gives the published rules of each kind of item a stage holds, and get_items reads a stage's items by code. Write, change and remove items with write_items; the spec owner signs them, and no tool signs. The spec owner assigns you threads by your name; a message telling you of one names it by its thread_id and gives the id of its assignment, which you pass to report_cannot_answer, its stage, what it asks (kind: message, an answer to the spec owner's message; update or review, the update or a review of the stage), and while the project has modules its module: pass that module to each tool that takes one. Read the thread with get_thread. Answer a thread with a reply in it, with reply_to_thread, or with write_items and its answers; a reply of yours to a thread assigned to you may give findings, each naming an item, a published rule of its kind that it breaks, and how. Your reply ends your assignment to the thread. When you cannot answer a thread assigned to you, pass the id of its assignment to report_cannot_answer. To point the spec owner to a set of items, coverages and impacts that need them, pass pointTo with write_items or reply_to_thread, with one text of at most 80 characters saying why. ${replyRulesText()}`;
}

/**
 * A store action of the spec owner's as the threads agents have may concern
 * it; null for one that concerns none, such as a signature.
 */
function storeAction(store: Store, moduleId: string, name: string, args: readonly unknown[], to: AgentId | null): SpecOwnerAction | null {
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
    case "replyAsSpecOwner": {
      const thread = typeof args[0] === "string" ? store.threads.find(({ id }) => id === args[0]) : undefined;
      return thread == null ? null : { kind: "send message", moduleId, stage: thread.stage, unitId: thread.unitId, threadId: thread.id, to, asksReview: false };
    }
    case "messageUnit": {
      const unitId = typeof args[0] === "string" ? args[0] : null;
      const stage = unitId == null ? null : store.unitState(unitId)?.stage;
      return unitId == null || stage == null ? null : { kind: "send message", moduleId, stage, unitId, threadId: store.openThreadOf(unitId)?.id ?? null, to, asksReview: false };
    }
    case "openStageThread":
      return typeof args[0] === "string" ? { kind: "send message", moduleId, stage: args[0], unitId: null, threadId: null, to, asksReview: false } : null;
    default:
      return null;
  }
}

/** The agent a target names, or the stand-in for a new internal agent; null for none. */
const targetAgent = (target: AssignTarget | null): AgentId | null => (target == null ? null : "agent" in target ? target.agent : NEW_AGENT);

/**
 * Delegation as a project host holds it: the threads waiting for an agent
 * and the agents that have them, the work agents do on the spec through the
 * agent interface, the notices agents get of their threads, and the gates
 * every action of the spec owner's that concerns those threads goes
 * through.
 */
export class DelegationHost {
  readonly desk: Desk;
  readonly api: DelegationHostApi;
  private sentView = "";
  private viewScheduled = false;
  private openProjectId: string | null = null;

  constructor(
    private readonly session: ProjectSession,
    private readonly agents: AgentsHost,
    /** Send the view to every client. */
    private readonly broadcast: (view: DelegationView) => void,
  ) {
    this.desk = new Desk(
      () => {
        const snapshot = session.getSnapshot();
        return snapshot.status === "ready" ? projectModules(snapshot.registry, snapshot.store, session.otherModuleStore) : [];
      },
      (record) => session.keepBeside("delegation", record),
    );
    const { desk } = this;
    desk.subscribe(() => this.scheduleView());
    agents.registry.subscribe(() => this.scheduleView());
    agents.runner.subscribe(() => this.scheduleView());
    agents.provideWork({
      tools: () => agentToolDescriptions(this.scope(null)),
      call: async (name, args, agent) => {
        const store = await this.openStore();
        const scope = this.scope(agent);
        const makes = agentToolChange(name, scope);
        const run = () => callAgentTool(store, name, args, scope, agent);
        return makes == null ? session.read(run) : session.change(makes, run, { agent: agent.label });
      },
      instructions: workInstructions,
    });
    // Archiving an agent that has threads is confirmed; once archived, its assignments end and no module has it as its agent.
    agents.guardArchiving((agentId, confirmed, asks) => void desk.check({ kind: "archive", agentId, asks }, confirmed, this.labelOf));
    agents.registry.onArchived((agentId) => {
      for (const held of desk.held()) {
        if (held.holder.agentId !== agentId) continue;
        agents.runner.abort(agentId, threadKey({ moduleId: held.moduleId, threadId: held.thread.id }));
        desk.endAssignment(held.holder.assignmentId, "archived");
      }
      desk.clearModuleAgent(agentId);
    });
    // A coding agent let in hears of each thread it has.
    agents.registry.onLetIn((agentId) => {
      for (const held of desk.held()) if (held.holder.agentId === agentId) this.tell(held, "let in");
    });
    // The agent that has a thread hears of each message another agent adds to it.
    desk.onAgentMessage((place, by) => {
      const held = desk.waitingIn(place.moduleId, place.threadId);
      if (held?.holder != null && held.holder.agentId !== by) this.tell(held as HeldThread, "message", by);
    });
    this.api = {
      assignThread: (key, target, confirmed = []) => {
        const waiting = desk.waitingThread(key);
        if (waiting.holder != null) throw new UserFacingError(`${this.labelOf(waiting.holder.agentId)} has that thread. Stop it first.`);
        const agentId = this.requireTarget(target, waiting.moduleId, waiting.stage, { moduleId: waiting.moduleId, threadId: waiting.thread.id });
        if (agentId != null) this.stop(desk.check({ kind: "assign", key, agentId }, confirmed, this.labelOf));
        this.assign(key, target);
      },
      stopAgents: (keys) => this.stop(desk.held().filter(({ key }) => keys.includes(key))),
      continueThread: (key) => {
        const waiting = desk.waitingThread(key);
        if (waiting.holder == null) throw new UserFacingError("No agent has that thread.");
        const problem = this.continueProblem(waiting as HeldThread);
        if (problem != null) throw new UserFacingError(problem);
        this.tell(waiting as HeldThread, "continue");
      },
      withdrawThread: (key) => desk.withdraw(key),
      askToUpdate: (moduleId, stages, target, confirmed = []) => this.ask("update", moduleId, stages, target, confirmed),
      askToReview: (moduleId, stage, target, confirmed = []) => this.ask("review", moduleId, [stage], target, confirmed),
      setModuleAgent: (moduleId, agentId) => {
        desk.module(moduleId);
        if (agentId != null) {
          const agent = agents.registry.agent(agentId);
          if (agent == null || agent.name == null || agent.archived) throw new UserFacingError("Only an agent that has a name and is not archived can be a module's agent.");
        }
        desk.setModuleAgent(moduleId, agentId);
      },
      readReplyChanges: (messageId) => desk.replyChanges(messageId),
    };
  }

  /** An agent as the spec owner reads it. */
  private readonly labelOf = (agentId: AgentId): string => this.agents.registry.label(agentId);

  /** What decides whether an agent can take a thread of a stage, apart from the agent. */
  private takeContext(moduleId: string, stage: string, thread: ThreadPlace | null): TakeContext {
    const { store } = this.desk.module(moduleId);
    const readOnly = this.desk.readOnlyBy(moduleId, stage);
    return {
      thread,
      stageOpen: store.stageOpen(stage),
      stageLabel: store.workflow.stage(stage).label,
      readOnlyBy: readOnly == null ? null : { agentId: readOnly.holder.agentId, agentLabel: this.labelOf(readOnly.holder.agentId), summary: this.desk.summary(readOnly) },
      startedIn: this.desk.kept.startedIn,
    };
  }

  /** The agent a target names, refused when it cannot take a thread of the stage; null for a new internal agent, once its template is known. */
  private requireTarget(target: AssignTarget, moduleId: string, stage: string, thread: ThreadPlace | null): AgentId | null {
    if ("template" in target) {
      if (!this.agents.registry.templates.read().some(({ id }) => id === target.template)) throw new UserFacingError("That template was removed.");
      const context = this.takeContext(moduleId, stage, thread);
      if (!context.stageOpen) throw new UserFacingError(`${context.stageLabel} is closed, so its threads can be assigned once it opens.`);
      if (context.readOnlyBy != null) throw new UserFacingError(`Only ${context.readOnlyBy.agentLabel} can take threads here while it has “${context.readOnlyBy.summary}”.`);
      return null;
    }
    const agent = this.agents.registry.agent(target.agent);
    if (agent == null) throw new UserFacingError("That agent is no longer there.");
    const why = whyCannotTake(agent, this.takeContext(moduleId, stage, thread));
    if (why != null) throw new UserFacingError(`${this.labelOf(agent.id)} cannot take this thread. ${why}`);
    return agent.id;
  }

  /** Hand a waiting thread no agent has to a target, starting a new internal agent for one that names a template, and tell the agent. */
  private assign(key: string, target: AssignTarget): void {
    const waiting = this.desk.waitingThread(key);
    const place = { moduleId: waiting.moduleId, threadId: waiting.thread.id };
    let agentId: AgentId;
    if ("template" in target) {
      agentId = this.agents.registry.startInternal(target.template, null);
      this.desk.startedIn(agentId, place);
    } else {
      agentId = target.agent;
    }
    this.desk.assign(key, agentId);
    this.tell(this.desk.waitingThread(key) as HeldThread, "assigned");
  }

  /** Stop the agents working on these threads: their assignments end, and each is told. */
  private stop(threads: readonly HeldThread[]): void {
    for (const held of threads) {
      const { agentId, assignmentId } = held.holder;
      this.desk.endAssignment(assignmentId, "stopped");
      const agent = this.agents.registry.agent(agentId);
      if (agent?.kind === "internal") {
        this.agents.runner.abort(agentId, threadKey({ moduleId: held.moduleId, threadId: held.thread.id }));
      } else {
        this.agents.registry.tell(agentId, {
          content: `The spec owner stopped you working on a thread: ${this.desk.summary(held)}. Your answer to it no longer counts; leave it.`,
          meta: this.noticeMeta(held, { stopped: "true" }),
        });
      }
    }
  }

  private noticeMeta(held: HeldThread, extra: Record<string, string> = {}): Record<string, string> {
    return { id: held.holder.assignmentId, thread_id: held.thread.id, stage: held.stage, kind: held.kind, ...(held.moduleName == null ? {} : { module: held.moduleName }), ...extra };
  }

  /**
   * Tell the agent that has a thread of it: that the thread was assigned to
   * it, that the spec owner asks it to continue, that another agent or the
   * spec owner added a message, or, once let in, that it has it. An internal
   * agent runs on it, or hears of it while it runs on it; a coding agent is
   * told only while its coding tool takes messages into its session and it
   * is let in.
   */
  private tell(held: HeldThread, why: "assigned" | "continue" | "message" | "let in", by: AgentId | null = null): void {
    const agent = this.agents.registry.agent(held.holder.agentId);
    if (agent == null || agent.archived) return;
    const summary = this.desk.summary(held);
    const prompt = assignmentPrompt(held, summary);
    const said: Record<typeof why, string> = {
      assigned: prompt,
      continue: `The spec owner asks you to continue your work on a thread assigned to you: ${summary}. ${prompt}`,
      message: `${by == null ? "The spec owner" : this.labelOf(by)} added a message to a thread assigned to you: ${summary}. Read it with get_thread before you go on.`,
      "let in": `You have a thread assigned to you: ${summary}. ${prompt}`,
    };
    if (agent.kind === "internal") {
      this.runInternal(held, agent, why === "message" ? said.message : said[why]);
      return;
    }
    if (!agent.letIn) return;
    if (this.agents.registry.tell(agent.id, { content: said[why], meta: this.noticeMeta(held) })) this.desk.noteNotified(held.holder.assignmentId);
  }

  /** Have an internal agent work on a thread it has: told while it runs on it, else run on it; a run its AI provider fails ends its assignment, with why. */
  private runInternal(held: HeldThread, agent: AgentView, prompt: string): void {
    const topic = threadKey({ moduleId: held.moduleId, threadId: held.thread.id });
    const { runner } = this.agents;
    if (runner.steer(agent.id, topic, prompt) || runner.busyWith(agent.id, topic)) return;
    const { assignmentId } = held.holder;
    void runner
      .run(agent.id, {
        topic: { key: topic, label: this.desk.summary(held) },
        instructions: workInstructions(),
        prompt,
        tools: this.agents.internalTools(),
        call: (name, args) => this.agents.callTool(name, args, { internalAgent: agent.id }),
        requestTimeoutMs: INTERNAL_REQUEST_TIMEOUT_MS,
      })
      .then((outcome) => {
        if (outcome.kind === "failed") this.desk.endAssignment(assignmentId, "failed", outcome.why);
      });
  }

  /** Why the agent that has a thread cannot be asked to continue its work on it now; null when it can. */
  private continueProblem(held: HeldThread): string | null {
    const agent = this.agents.registry.agent(held.holder.agentId);
    if (agent == null) return "Its agent is gone.";
    if (agent.kind === "internal") {
      return this.agents.runner.busyWith(agent.id, threadKey({ moduleId: held.moduleId, threadId: held.thread.id })) ? "It is running on the thread now." : null;
    }
    if (!agent.connected) return "It is not connected.";
    if (!agent.reachable) return "Its coding tool takes no message into its session.";
    if (!agent.letIn) return "You have not let it in since it last connected.";
    if (this.desk.readSinceNotified(held.holder.assignmentId)) return "It read the thread since it was last told of it, so it is working on it.";
    return null;
  }

  /** Refuse an action of the spec owner's while it concerns what `confirmed` does not name; stop the agents it concerns. */
  private clearAction(action: SpecOwnerAction, confirmed: readonly string[]): void {
    this.stop(this.desk.check(action, confirmed, this.labelOf));
  }

  /**
   * The spec owner's message, the last of a thread, set it waiting: what
   * waited in the thread before ends. The agent that has the thread, sent
   * the message, keeps it and is told; else the thread is assigned to the
   * target, if any.
   */
  private setWaiting(moduleId: string, threadId: string, target: AssignTarget | null): void {
    const { store } = this.desk.module(moduleId);
    const message = store.threads.find(({ id }) => id === threadId)?.messages.at(-1);
    if (message == null) return;
    const wait = this.desk.setWaiting(moduleId, threadId, message.id);
    const waiting = this.desk.waitingThread(wait.id);
    if (waiting.holder != null) {
      this.tell(waiting as HeldThread, "message");
      return;
    }
    if (target != null) this.assign(wait.id, target);
  }

  /** Ask for stages to be updated, or one reviewed, each in a thread of its own on the stage, assigned to the target, or to none. */
  private ask(kind: "update" | "review", moduleId: string, stages: readonly string[], target: AssignTarget | null, confirmed: readonly string[]): void {
    const asked = this.desk.module(moduleId);
    const { store } = asked;
    if (stages.length === 0) throw new UserFacingError("Name a stage to ask for.");
    for (const stage of stages) {
      if (!store.workflow.isStage(stage)) throw new UserFacingError(`There is no stage ${stage}.`);
      const problem = kind === "update" ? updateAskProblem(asked, this.desk.kept, stage) : reviewAskProblem(asked, this.desk.kept, stage);
      if (problem != null) throw new UserFacingError(problem);
      if (target != null) this.requireTarget(target, moduleId, stage, null);
    }
    // What every thread asked concerns is confirmed at once.
    const to = targetAgent(target);
    const threads = new Map<string, HeldThread>();
    const notes = new Map<string, ConfirmationNote>();
    for (const stage of stages) {
      const concerned = this.desk.concernedBy({ kind: "send message", moduleId, stage, unitId: null, threadId: null, to, asksReview: kind === "review" }, this.labelOf);
      for (const held of concerned.threads) threads.set(held.key, held);
      for (const note of concerned.notes) notes.set(note.key, note);
    }
    if ([...threads.keys(), ...notes.keys()].some((key) => !confirmed.includes(key))) {
      throw new ConfirmationNeededError([...threads.values()].map((held) => this.desk.state(held)), [...notes.values()]);
    }
    this.stop([...threads.values()]);
    const active = this.session.getSnapshot().registry?.activeModuleId;
    const labels = stages.map((stage) => store.workflow.stage(stage).label);
    this.session.change(
      "thread message",
      () => {
        for (const stage of stages) {
          const args = [stage, askText(kind, store.workflow.stage(stage).label), asksAnnotation(kind)] as const;
          const threadId = moduleId === active ? store.openStageThread(...args) : this.session.changeOtherModule(moduleId, (other) => other.openStageThread(...args));
          this.setWaiting(moduleId, threadId, target);
        }
      },
      "spec owner",
      undefined,
      kind === "update" ? `Asked for the update of ${labels.join(", ")}` : `Asked for a review of ${labels.join(", ")}`,
    );
  }

  /**
   * Refuse a store action of the spec owner's while it concerns threads
   * agents have that `confirmed` does not name, or while it would assign its
   * thread to an agent that cannot take it; stop the agents it concerns.
   */
  clearStoreAction(store: Store, name: string, args: readonly unknown[], confirmed: readonly string[], target: AssignTarget | null): void {
    const moduleId = this.session.getSnapshot().registry?.activeModuleId;
    if (moduleId == null) return;
    const action = storeAction(store, moduleId, name, args, targetAgent(target));
    if (action == null) return;
    if (action.kind === "send message" && target != null) {
      const holder = action.threadId == null ? null : this.desk.waitingIn(moduleId, action.threadId)?.holder;
      // The agent that has the thread keeps it; any other target must be able to take it.
      if (!("agent" in target) || holder?.agentId !== target.agent) {
        this.requireTarget(target, moduleId, action.stage, action.threadId == null ? null : { moduleId, threadId: action.threadId });
      }
    }
    this.clearAction(action, confirmed);
  }

  /** A store action of the spec owner's was carried out: a message of theirs set its thread waiting, assigned to the target, if any; a resolution ended its wait. */
  storeActionDone(store: Store, name: string, args: readonly unknown[], result: unknown, target: AssignTarget | null): void {
    const moduleId = this.session.getSnapshot().registry?.activeModuleId;
    if (moduleId == null) return;
    if (name === "resolveThread" && typeof args[0] === "string") {
      this.desk.resolved(moduleId, args[0]);
      return;
    }
    const threadId = name === "replyAsSpecOwner" ? args[0] : name === "messageUnit" || name === "openStageThread" ? result : null;
    if (typeof threadId === "string" && store.threads.some(({ id }) => id === threadId)) this.setWaiting(moduleId, threadId, target);
  }

  /**
   * Refuse an action of the spec owner's that shows another state of the
   * project, such as undo or an import, while it concerns threads agents
   * have that `confirmed` does not name; stop the agents it names. Whether
   * each thread waits, and which agent has it, stays as it is.
   */
  async clearReplacing(action: ReplacingAction, confirmed: readonly string[] = []): Promise<void> {
    const after = await this.session.stateAfter(action);
    if (after != null) this.clearAction({ kind: "move in history", after: projectModulesOfState(after) }, confirmed);
  }

  /** The session changed: a project that opens brings what Delegation kept beside it. */
  sessionChanged(): void {
    const snapshot = this.session.getSnapshot();
    const projectId = snapshot.status === "ready" ? snapshot.activeProject.id : null;
    if (projectId !== this.openProjectId) {
      this.openProjectId = projectId;
      this.desk.load(projectId == null ? null : this.session.keptBeside("delegation"));
    }
    this.scheduleView();
  }

  /** The shown store changed: what threads and items show may have changed with it. */
  storeChanged(): void {
    this.scheduleView();
  }

  view(): DelegationView {
    const { desk } = this;
    const modules = desk.modules();
    const record = desk.kept;
    const waiting = desk.waiting(modules).map((each): WaitingView => ({ ...desk.state(each), continueProblem: each.holder == null ? null : this.continueProblem(each as HeldThread) }));
    const threadAgents: Record<string, AgentId[]> = {};
    for (const assignment of record.assignments) (threadAgents[threadKey(assignment)] ??= []).push(assignment.agentId);
    return {
      waiting,
      withdrawn: record.waits.flatMap((wait) => (wait.ended?.how === "withdrawn" ? [{ moduleId: wait.moduleId, threadId: wait.threadId, messageId: wait.messageId, at: wait.ended.at }] : [])),
      findings: this.findings(modules),
      asks: modules.flatMap((module) =>
        module.store.workflow.stageIds.flatMap((stage): StageAsks[] => {
          const update = updateAskProblem(module, record, stage) == null;
          const review = reviewAskProblem(module, record, stage) == null;
          const updateAfter = stagesToUpdateAfter(module, record, stage);
          return !update && !review && updateAfter.length === 0 ? [] : [{ moduleId: module.id, stage, update, review, updateAfter }];
        }),
      ),
      moduleAgents: record.moduleAgents,
      failures: record.failures,
      threadAgents,
      startedIn: record.startedIn,
    };
  }

  /** Every finding the replies of the open project's modules give, whatever module the item it names is of. */
  private findings(modules: readonly ProjectModule[]): FindingView[] {
    return modules.flatMap((module) =>
      module.store.threads.flatMap((thread) =>
        thread.messages.flatMap((message) => {
          if (message.author.kind !== "agent") return [];
          const agentId = replyAgent(message);
          return findingsOf(message).map((finding): FindingView => {
            const version = module.store.findLinked(finding.itemId)?.version;
            const writer = version == null ? null : this.desk.writerOf(finding.itemId, revisionOf(version));
            return {
              moduleId: module.id,
              threadId: thread.id,
              messageId: message.id,
              agentId,
              writtenBy: message.author.kind === "agent" ? message.author.name : "",
              at: message.at,
              ...finding,
              ownWork: agentId != null && writer === agentId,
            };
          });
        }),
      ),
    );
  }

  /** Send the view once the change running now is made, when it changed. */
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

  /**
   * What an agent works on: the module the page shows, every other module by
   * its name, read or changed without showing it, and the threads waiting
   * for an agent. Nothing an agent does moves the spec owner's page.
   */
  private scope(agent: CallingAgent | null): WorkScope {
    const snapshot = this.session.getSnapshot();
    const { registry } = snapshot;
    if (registry == null) return {};
    const pointOut: WorkScope["pointOut"] = (units, text) => {
      const places = units.map((unit) => {
        const moduleId = unit.module == null ? registry.activeModuleId : visibleModuleNamed(registry, unit.module)?.id;
        if (moduleId == null) throw new UserFacingError(`There is no module named “${unit.module}”.`);
        return { moduleId, stage: unit.stage, unitId: unit.unitId };
      });
      this.session.pointOut(places, text, agent?.label ?? "An agent");
    };
    const base: WorkScope = { desk: this.desk, moduleId: registry.activeModuleId, labelOf: this.labelOf, pointOut };
    if (!registry.modulesEnabled) return base;
    const moduleName = activeModule(registry)?.name;
    if (moduleName == null) return base;
    const modules = visibleModules(registry);
    const moduleNamed = (name: string) => {
      const target = visibleModuleNamed(registry, name);
      if (target != null) return target;
      throw new UserFacingError(`There is no module named “${name}”. The modules are ${modules.map((entry) => `“${entry.name}”`).join(", ")}.`);
    };
    return {
      ...base,
      moduleName,
      ...(modules.length > 1
        ? {
            otherModule: (name: string) => {
              const target = moduleNamed(name);
              const store = target.id === registry.activeModuleId ? snapshot.store : this.session.otherModuleStore(target.id);
              if (store == null) throw new UserFacingError(`“${target.name}” could not be read.`);
              return { id: target.id, name: target.name, store, change: <Result>(run: (changed: Store) => Result): Result => this.session.changeOtherModule(target.id, run) };
            },
          }
        : {}),
      addModule: (name) => this.session.addModule(name, { show: false }),
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

