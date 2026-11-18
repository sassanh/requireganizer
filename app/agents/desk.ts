import { getSnapshot } from "mobx-state-tree";

import { UserFacingError } from "lib/errors";

import { type AgentRequest, requestSummary, type RequestModule, waitingRequests } from "./requests";
import type { AgentId, AgentRoster, AgentView } from "./roster";
import type { ModuleRequests } from "./section";

/** What an agent is told about a request of its. */
export type AgentNotice =
  | { type: "given"; request: AgentRequest; summary: string }
  | { type: "stopped"; request: AgentRequest; summary: string };

/** A waiting request as the spec owner sees it. */
export interface RequestState extends AgentRequest {
  /** What it asks, in one line. */
  summary: string;
  /** The agent that has it and since when; null while no agent has it. */
  holder: { agentId: AgentId; name: string; since: string } | null;
  /** Why the agent it was last given to failed to answer it, until it is given again. */
  failure: string | null;
  /** The agents it can be given to now: none while an agent has it or its stage is closed. */
  givableTo: AgentId[];
  /** Its stage is open; a request in a closed stage is given once the stage opens. */
  stageOpen: boolean;
}

/** The agents and the waiting requests, as the page shows them. */
export interface DeskView {
  agents: AgentView[];
  requests: RequestState[];
}

/**
 * An action of the spec owner's that may concern requests agents have,
 * asked about before it is carried out.
 */
export type SpecOwnerAction =
  | { kind: "resolve thread"; moduleId: string; threadId: string }
  /** A message in a thread, its change request made anew and given to `to`, or to none. */
  | { kind: "send message"; moduleId: string; threadId: string; to: AgentId | null }
  | { kind: "change items"; moduleId: string; stages: readonly string[] }
  | { kind: "give"; key: string; agentId: AgentId }
  /** Making a request to write or to review a stage and giving it to `agentId` in the same act. */
  | { kind: "make"; moduleId: string; stage: string; agentId: AgentId }
  /** Undo, redo or going to a step: the modules as the move would leave them. */
  | { kind: "move in history"; after: readonly RequestModule[] };

/** An agent's write of items, as the requests agents have may refuse it. */
export interface AgentWrite {
  moduleId: string;
  /** The stages its changes change. */
  stages: readonly string[];
  /** The stages it would close. */
  closes: readonly string[];
  /** The threads it answers with its changes. */
  answers: readonly string[];
  /** The request to write it marks fulfilled, if it does. */
  fulfils: AgentRequest | null;
}

/**
 * An action of the spec owner's refused because it concerns requests agents
 * have: carried out once the spec owner confirms stopping them.
 */
export class RequestsConcernedError extends UserFacingError {
  constructor(readonly requests: RequestState[]) {
    super(`This concerns ${requests.length === 1 ? "a request an agent has" : "requests agents have"}: ${requests.map(({ summary }) => summary).join("; ")}. Stop ${requests.length === 1 ? "it" : "them"} first.`);
    this.name = "RequestsConcernedError";
  }
}

/** A stage's items as a change to them is told apart, signatures left out: signing changes no item. */
function itemsOf(store: RequestModule["store"], stage: string): string {
  const node = store.stages.get(stage);
  return node == null ? "[]" : JSON.stringify(getSnapshot(node).items.map(({ id, kind, content, references, dependencies }) => [id, kind, content, references, dependencies]));
}

/** A request whose stage a request to write or to review makes read-only to all but the agent that has it. */
const makesReadOnly = (request: AgentRequest) => request.kind === "write" || request.kind === "review";

/**
 * Which agent has each waiting request of the open project, kept in memory
 * only: a project that opens has every request no agent's, and undo, redo
 * and moving through the history change nothing here. What waits is read
 * from the modules each time; only who has it is kept.
 */
export class AgentDesk {
  private readonly held = new Map<string, { agentId: AgentId; since: string }>();
  private readonly failures = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private readonly noticeListeners = new Set<(agentId: AgentId, notice: AgentNotice) => void>();

  constructor(
    readonly roster: AgentRoster,
    /** The open project's modules; none while no project is open. */
    private readonly modules: () => readonly RequestModule[],
  ) {
    roster.subscribe(() => this.changed());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Hear of each request given to an agent and of each one stopped, for the agent to be told. */
  subscribeNotices(listener: (agentId: AgentId, notice: AgentNotice) => void): () => void {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  private notify(agentId: AgentId, notice: AgentNotice): void {
    for (const listener of this.noticeListeners) listener(agentId, notice);
  }

  private module(moduleId: string): RequestModule {
    const found = this.modules().find(({ id }) => id === moduleId);
    if (found == null) throw new UserFacingError("That module is no longer open.");
    return found;
  }

  waiting(): AgentRequest[] {
    return waitingRequests(this.modules());
  }

  private waitingRequest(key: string): AgentRequest {
    const request = this.waiting().find((candidate) => candidate.key === key);
    if (request == null) throw new UserFacingError("That request no longer waits.");
    return request;
  }

  /**
   * The waiting request with this id that an agent has; refused when it no
   * longer waits, another agent has it, or it is not of `kind`.
   */
  requireHeldRequest(agentId: AgentId, key: string, kind?: "write" | "review"): AgentRequest {
    const request = this.waitingRequest(key);
    if (kind != null && request.kind !== kind) throw new UserFacingError(`That request is not a request to ${kind} a stage.`);
    if (this.holderOf(key)?.agentId !== agentId) throw new UserFacingError("That request is not yours, so only the agent that has it can answer it.");
    return request;
  }

  /** What the Agents module keeps of a module of the open project. */
  requestsOf(moduleId: string): ModuleRequests {
    return this.module(moduleId).requests;
  }

  summary(request: AgentRequest): string {
    return requestSummary(request, this.module(request.moduleId).store);
  }

  /** The agent that has a request and since when; null while no agent has it, such as once its agent is no longer available. */
  holderOf(key: string): { agentId: AgentId; since: string } | null {
    const holding = this.held.get(key);
    return holding == null || !this.roster.isAvailable(holding.agentId) ? null : holding;
  }

  /** Every waiting request an agent has. */
  heldRequests(): (AgentRequest & { agentId: AgentId; since: string })[] {
    return this.waiting().flatMap((request) => {
      const holding = this.holderOf(request.key);
      return holding == null ? [] : [{ ...request, ...holding }];
    });
  }

  /**
   * The request to write or to review that makes a stage read-only to all
   * but the agent that has it: one on that stage or on a stage it builds on.
   */
  readOnlyBy(moduleId: string, stage: string, held = this.heldRequests()): (AgentRequest & { agentId: AgentId }) | null {
    const { workflow } = this.module(moduleId).store;
    return (
      held.find(
        (request) => request.moduleId === moduleId && makesReadOnly(request) && (request.stage === stage || workflow.buildsOn(stage, request.stage)),
      ) ?? null
    );
  }

  /** The agents a request can be given to now. */
  givableTo(request: AgentRequest, held = this.heldRequests()): AgentId[] {
    if (this.holderOf(request.key) != null) return [];
    const { store } = this.module(request.moduleId);
    if (!store.stageOpen(request.stage)) return [];
    const readOnly = this.readOnlyBy(request.moduleId, request.stage, held);
    const available = this.roster.available().map(({ id }) => id);
    return readOnly == null ? available : available.filter((id) => id === readOnly.agentId);
  }

  /**
   * Give a waiting request no agent has to an available agent. Refused for a
   * request whose stage is closed, for a unit or stage another agent's
   * request to write or review makes read-only, and while requests of other
   * agents would be made read-only by it: the spec owner stops those first.
   */
  give(key: string, agentId: AgentId): void {
    const request = this.waitingRequest(key);
    const holder = this.holderOf(key);
    if (holder != null) throw new UserFacingError(`${this.roster.nameOf(holder.agentId)} has that request. Stop it first.`);
    const name = this.roster.nameOf(agentId);
    if (name == null) throw new UserFacingError("That agent is no longer available.");
    const { store } = this.module(request.moduleId);
    if (!store.stageOpen(request.stage)) {
      throw new UserFacingError(`${store.workflow.stage(request.stage).label} is closed, so its requests can be given once it opens.`);
    }
    const readOnly = this.readOnlyBy(request.moduleId, request.stage);
    if (readOnly != null && readOnly.agentId !== agentId) {
      throw new UserFacingError(`${this.summary(readOnly)} is with ${this.roster.nameOf(readOnly.agentId)}, so this request can go to that agent only.`);
    }
    const concerned = this.concernedBy({ kind: "give", key, agentId });
    if (concerned.length > 0) {
      throw new UserFacingError(`Stop first what other agents have there: ${concerned.map(({ summary }) => summary).join("; ")}.`);
    }
    this.held.set(key, { agentId, since: new Date().toISOString() });
    this.failures.delete(key);
    this.changed();
    this.notify(agentId, { type: "given", request, summary: this.summary(request) });
  }

  /** Take a request back from the agent that has it, which is told so; the request still waits. */
  stop(key: string): void {
    const holder = this.holderOf(key);
    this.held.delete(key);
    if (holder == null) return;
    this.changed();
    const request = this.waiting().find((candidate) => candidate.key === key);
    if (request != null) this.notify(holder.agentId, { type: "stopped", request, summary: this.summary(request) });
  }

  stopAll(keys: readonly string[]): void {
    for (const key of keys) this.stop(key);
  }

  /**
   * The agent that has a request failed to answer it, such as when its AI
   * provider failed or it reported it cannot: the request is no agent's
   * and still waits, shown with why until it is given again.
   */
  fail(key: string, agentId: AgentId, why: string): void {
    const holder = this.holderOf(key);
    if (holder?.agentId !== agentId) throw new UserFacingError("That request is not yours, so only the agent that has it can report it.");
    if (why.trim().length === 0) throw new UserFacingError("Say why the request cannot be answered.");
    this.held.delete(key);
    this.failures.set(key, why.trim());
    this.changed();
  }

  /** The request may be withdrawn: it waits and no agent has it. */
  requireWithdrawable(key: string): AgentRequest {
    const request = this.waitingRequest(key);
    const holder = this.holderOf(key);
    if (holder != null) throw new UserFacingError(`${this.roster.nameOf(holder.agentId)} has that request. Stop it before withdrawing it.`);
    return request;
  }

  /**
   * Let go of what no longer waits, once a change is made: an answered or
   * withdrawn request is no agent's, even when undo makes it wait again.
   */
  settle(): void {
    const waiting = new Set(this.waiting().map(({ key }) => key));
    let dropped = false;
    for (const key of [...this.held.keys(), ...this.failures.keys()]) {
      if (waiting.has(key)) continue;
      dropped = this.held.delete(key) || dropped;
      dropped = this.failures.delete(key) || dropped;
    }
    if (dropped) this.changed();
  }

  /** The project opened: every waiting request is no agent's. */
  forget(): void {
    if (this.held.size === 0 && this.failures.size === 0) return;
    this.held.clear();
    this.failures.clear();
    this.changed();
  }

  /** Why the requests other agents have refuse an agent's write; empty when they do not. */
  writeProblems(agentId: AgentId, write: AgentWrite): string[] {
    const { store } = this.module(write.moduleId);
    const label = (stage: string) => store.workflow.stage(stage).label;
    const problems: string[] = [];
    for (const stage of write.stages) {
      const readOnly = this.readOnlyBy(write.moduleId, stage);
      if (readOnly != null && readOnly.agentId !== agentId) {
        problems.push(`${label(stage)} takes changes only from ${this.roster.nameOf(readOnly.agentId)} while it has “${this.summary(readOnly)}”.`);
      }
    }
    for (const request of this.heldRequests()) {
      if (request.moduleId !== write.moduleId || request.agentId === agentId || !write.closes.includes(request.stage)) continue;
      problems.push(`This write closes ${label(request.stage)}, where ${this.roster.nameOf(request.agentId)} has “${this.summary(request)}”.`);
    }
    for (const threadId of write.answers) {
      const request = this.waiting().find((candidate) => candidate.moduleId === write.moduleId && candidate.thread?.id === threadId);
      if (request == null) problems.push(`No change request waits in thread ${threadId}, so no write answers it. Add a message with reply_to_thread instead.`);
      else if (this.holderOf(request.key)?.agentId !== agentId) problems.push(`The change request of thread ${threadId} is not yours, so you may add a message to it but not answer it with changes.`);
    }
    if (write.fulfils != null) {
      const fulfilled = write.fulfils;
      const elsewhere = write.stages.filter((stage) => stage !== fulfilled.stage);
      if (elsewhere.length > 0) problems.push(`A write that marks the request to write ${label(fulfilled.stage)} fulfilled changes only that stage; this one also changes ${elsewhere.map(label).join(", ")}.`);
    }
    return problems;
  }

  /**
   * The requests agents have that an action of the spec owner's would end,
   * whose stage it would close, whose read-only stage it would change, or
   * that would be in a stage it makes read-only to another agent: the
   * spec owner confirms stopping them before it is carried out.
   */
  concernedBy(action: SpecOwnerAction): RequestState[] {
    const held = this.heldRequests();
    const concerned = (() => {
      switch (action.kind) {
        case "resolve thread":
          return held.filter((request) => request.moduleId === action.moduleId && request.thread?.id === action.threadId);
        case "send message":
          return held.filter((request) => request.moduleId === action.moduleId && request.thread?.id === action.threadId && request.agentId !== action.to);
        case "change items": {
          const { store } = this.module(action.moduleId);
          const { workflow } = store;
          return held.filter((request) => {
            if (request.moduleId !== action.moduleId) return false;
            const readOnlyHere = makesReadOnly(request) && action.stages.some((stage) => stage === request.stage || workflow.buildsOn(stage, request.stage));
            const closes = action.stages.some((stage) => store.stageComplete(stage) && workflow.buildsOn(request.stage, stage));
            return readOnlyHere || closes;
          });
        }
        case "give":
        case "make": {
          const given = action.kind === "give" ? this.waitingRequest(action.key) : action;
          if (action.kind === "give" && !makesReadOnly(this.waitingRequest(action.key))) return [];
          const { workflow } = this.module(given.moduleId).store;
          return held.filter(
            (request) => request.moduleId === given.moduleId && request.agentId !== action.agentId && (request.stage === given.stage || workflow.buildsOn(request.stage, given.stage)),
          );
        }
        case "move in history": {
          const waitingAfter = new Set(waitingRequests(action.after).map(({ key }) => key));
          return held.filter((request) => {
            const before = this.module(request.moduleId).store;
            const after = action.after.find(({ id }) => id === request.moduleId)?.store;
            if (after == null || !waitingAfter.has(request.key)) return true;
            if (before.stageOpen(request.stage) && !after.stageOpen(request.stage)) return true;
            if (!makesReadOnly(request)) return false;
            return before.workflow.stageIds.some((stage) => {
              if (stage !== request.stage && !before.workflow.buildsOn(stage, request.stage)) return false;
              return itemsOf(before, stage) !== itemsOf(after, stage);
            });
          });
        }
      }
    })();
    return concerned.map((request) => this.state(request, held));
  }

  private state(request: AgentRequest, held: ReturnType<AgentDesk["heldRequests"]>): RequestState {
    const holding = this.holderOf(request.key);
    return {
      ...request,
      summary: this.summary(request),
      holder: holding == null ? null : { ...holding, name: this.roster.nameOf(holding.agentId)! },
      failure: this.failures.get(request.key) ?? null,
      givableTo: this.givableTo(request, held),
      stageOpen: this.module(request.moduleId).store.stageOpen(request.stage),
    };
  }

  /**
   * Let an action of the spec owner's be carried out: refused while it
   * concerns requests agents have, unless `stopping` names each of them,
   * which are then stopped.
   */
  clear(action: SpecOwnerAction, stopping: readonly string[] = []): void {
    const concerned = this.concernedBy(action);
    const unconfirmed = concerned.filter(({ key }) => !stopping.includes(key));
    if (unconfirmed.length > 0) throw new RequestsConcernedError(concerned);
    this.stopAll(concerned.map(({ key }) => key));
  }

  view(): DeskView {
    const held = this.heldRequests();
    return { agents: this.roster.list(), requests: this.waiting().map((request) => this.state(request, held)) };
  }
}
