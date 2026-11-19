import { getSnapshot } from "mobx-state-tree";

import { UserFacingError } from "lib/errors";
import { uuid } from "utilities";

import { findingsOf } from "./annotations";
import { parseRequestRecords, type RequestRecord, type RunLog, type RunLogEntry } from "./record";
import {
  type AgentRequest,
  endIn,
  makesReadOnly,
  readOnlyRequest,
  requestSummary,
  type RequestModule,
  reviewAskProblem,
  stagesToAskAfter,
  waitingRequests,
} from "./requests";
import type { AgentId, AgentRoster, AgentView } from "./roster";

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

/** What a thread shows of a request made in it beside its messages: that it was withdrawn and when, and the run logs kept with it. */
export interface RequestNote {
  key: string;
  moduleId: string;
  threadId: string;
  /** The message that made it. */
  messageId: string;
  withdrawnAt: string | null;
  runLogs: { agent: string; from: string; until: string | null }[];
}

/** A finding a reply gives, with the reply's thread and module, the agent that gave it and when. */
export interface FindingView {
  moduleId: string;
  threadId: string;
  messageId: string;
  agent: string;
  at: string | null;
  itemId: string;
  revision: string;
  rule: string;
  how: string;
}

/** What the spec owner may ask from a stage of a module now: the writing of each stage listed, and a review of the stage itself. */
export interface StageAsks {
  moduleId: string;
  stage: string;
  write: string[];
  review: boolean;
}

/** The agents, the waiting requests, what threads and items show of requests, and what each stage may ask for, as the page shows them. */
export interface DeskView {
  agents: AgentView[];
  requests: RequestState[];
  notes: RequestNote[];
  findings: FindingView[];
  asks: StageAsks[];
}

/**
 * An action of the spec owner's that may concern requests agents have,
 * asked about before it is carried out.
 */
export type SpecOwnerAction =
  | { kind: "resolve thread"; moduleId: string; threadId: string }
  /**
   * A message in a thread, or one opening a thread, on a unit or on the
   * stage itself; its change request made anew and given to `to`, or to none.
   */
  | { kind: "send message"; moduleId: string; stage: string; unitId: string | null; threadId: string | null; to: AgentId | null }
  | { kind: "change items"; moduleId: string; stages: readonly string[] }
  | { kind: "give"; key: string; agentId: AgentId }
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

const now = () => new Date().toISOString();

/**
 * The open project's requests: what each one was made by, how it ended and
 * its run logs, kept beside the project through `keep`, which no undo, redo
 * or step gone to moves; and which agent has each, kept in memory only, so
 * a project that opens has every request no agent's. Whether a request
 * waits is read from the record and the modules each time.
 */
export class AgentDesk {
  private records: RequestRecord[] = [];
  private readonly held = new Map<string, { agentId: AgentId; since: string }>();
  private readonly failures = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private readonly noticeListeners = new Set<(agentId: AgentId, notice: AgentNotice) => void>();

  constructor(
    readonly roster: AgentRoster,
    /** The open project's modules; none while no project is open. */
    private readonly modules: () => readonly RequestModule[],
    /** Keep the requests beside the open project. */
    private readonly keep: (records: readonly RequestRecord[]) => void,
  ) {
    roster.subscribe(() => this.releaseUnavailable());
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

  /** Change the records and keep them. */
  private save(records: RequestRecord[]): void {
    this.records = records;
    this.keep(records);
  }

  private update(key: string, change: (record: RequestRecord) => RequestRecord): void {
    this.save(this.records.map((record) => (record.id === key ? change(record) : record)));
  }

  /** The request's run log open now, if one is, closed. */
  private closeRunLog(key: string): void {
    const record = this.records.find(({ id }) => id === key);
    if (record == null || !record.runLogs.some(({ until }) => until == null)) return;
    const at = now();
    this.update(key, (found) => ({ ...found, runLogs: found.runLogs.map((log) => (log.until == null ? { ...log, until: at } : log)) }));
  }

  /** No agent has the request any more. */
  private release(key: string): void {
    this.held.delete(key);
    this.closeRunLog(key);
  }

  /** An agent that is no longer available has no request; its run logs end. */
  private releaseUnavailable(): void {
    for (const [key, { agentId }] of [...this.held]) if (!this.roster.isAvailable(agentId)) this.release(key);
    this.changed();
  }

  /**
   * The project opened, with the requests its record kept: every waiting
   * request is no agent's, and a run log still open ends with its last entry.
   */
  load(value: unknown): void {
    this.held.clear();
    this.failures.clear();
    this.records = parseRequestRecords(value).map((record) => ({
      ...record,
      runLogs: record.runLogs.map((log) => (log.until == null ? { ...log, until: log.entries.at(-1)?.at ?? log.from } : log)),
    }));
    this.changed();
  }

  private module(moduleId: string): RequestModule {
    const found = this.modules().find(({ id }) => id === moduleId);
    if (found == null) throw new UserFacingError("That module is no longer open.");
    return found;
  }

  /** The requests made in the open project, ended or not. */
  requestRecords(): readonly RequestRecord[] {
    return this.records;
  }

  waiting(): AgentRequest[] {
    return waitingRequests(this.modules(), this.records);
  }

  private waitingRequest(key: string): AgentRequest {
    const request = this.waiting().find((candidate) => candidate.key === key);
    if (request == null) throw new UserFacingError("That request no longer waits.");
    return request;
  }

  /** The change request that waits in a thread, if one does. */
  waitingIn(moduleId: string, threadId: string): AgentRequest | null {
    return this.waiting().find((request) => request.moduleId === moduleId && request.thread.id === threadId) ?? null;
  }

  /** The waiting request with this id that an agent has; refused when it no longer waits or another agent has it. */
  requireHeldRequest(agentId: AgentId, key: string): AgentRequest {
    const request = this.waitingRequest(key);
    if (this.holderOf(key)?.agentId !== agentId) throw new UserFacingError("That request is not yours, so only the agent that has it can answer it.");
    return request;
  }

  summary(request: AgentRequest): string {
    return requestSummary(request, this.module(request.moduleId).store);
  }

  /** The agent that has a request and since when; null while no agent has it. */
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

  /** The request on a stage itself that makes a stage read-only to all but the agent that has it: one on that stage or on a stage it builds on. */
  readOnlyBy(moduleId: string, stage: string, held = this.heldRequests()): (AgentRequest & { agentId: AgentId }) | null {
    return readOnlyRequest(held, this.module(moduleId).store, moduleId, stage);
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
   * A request in a stage of a module may go to an agent: the agent is
   * available, the stage is open, and no other agent's request on a stage
   * itself makes the stage read-only.
   */
  requireGivable(moduleId: string, stage: string, agentId: AgentId): void {
    if (this.roster.nameOf(agentId) == null) throw new UserFacingError("That agent is no longer available.");
    const { store } = this.module(moduleId);
    if (!store.stageOpen(stage)) throw new UserFacingError(`${store.workflow.stage(stage).label} is closed, so its requests can be given once it opens.`);
    const readOnly = this.readOnlyBy(moduleId, stage);
    if (readOnly != null && readOnly.agentId !== agentId) {
      throw new UserFacingError(`${this.summary(readOnly)} is with ${this.roster.nameOf(readOnly.agentId)}, so this request can go to that agent only.`);
    }
  }

  /** The spec owner's message `messageId` in a thread made a request; returns its id. Whatever waited in the thread before is made anew, once settled. */
  make(moduleId: string, threadId: string, messageId: string): string {
    const record: RequestRecord = { id: uuid(), moduleId, threadId, messageId, madeAt: now(), ended: null, runLogs: [] };
    this.save([...this.records, record]);
    this.changed();
    return record.id;
  }

  /**
   * Give a waiting request no agent has to an available agent. Refused for a
   * request whose stage is closed, for a unit or stage another agent's
   * request on a stage itself makes read-only, and while requests of other
   * agents would be made read-only by it: the spec owner stops those first.
   */
  give(key: string, agentId: AgentId): void {
    const request = this.waitingRequest(key);
    const holder = this.holderOf(key);
    if (holder != null) throw new UserFacingError(`${this.roster.nameOf(holder.agentId)} has that request. Stop it first.`);
    this.requireGivable(request.moduleId, request.stage, agentId);
    const name = this.roster.nameOf(agentId)!;
    const concerned = this.concernedBy({ kind: "give", key, agentId });
    if (concerned.length > 0) {
      throw new UserFacingError(`Stop first what other agents have there: ${concerned.map(({ summary }) => summary).join("; ")}.`);
    }
    const since = now();
    this.held.set(key, { agentId, since });
    this.failures.delete(key);
    // What an agent Requireganizer runs does with the request is kept with it from now on.
    if (this.roster.runAgent(agentId) != null) {
      this.update(key, (record) => ({ ...record, runLogs: [...record.runLogs, { agent: name, from: since, until: null, entries: [] }] }));
    }
    this.changed();
    this.notify(agentId, { type: "given", request, summary: this.summary(request) });
  }

  /** Take a request back from the agent that has it, which is told so; the request still waits. */
  stop(key: string): void {
    const holder = this.holderOf(key);
    this.release(key);
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
    this.release(key);
    this.failures.set(key, why.trim());
    this.changed();
  }

  /** The agent that has a request replied in its thread: it no longer waits, and no agent has it. */
  answered(key: string): void {
    this.release(key);
    this.update(key, (record) => ({ ...record, ended: { how: "answered", at: now() } }));
    this.changed();
  }

  /**
   * Withdraw a waiting request no agent has: it no longer waits, and its
   * thread shows that it was withdrawn and when. The project does not change.
   */
  withdraw(key: string): void {
    this.waitingRequest(key);
    const holder = this.holderOf(key);
    if (holder != null) throw new UserFacingError(`${this.roster.nameOf(holder.agentId)} has that request. Stop it before withdrawing it.`);
    this.failures.delete(key);
    this.update(key, (record) => ({ ...record, ended: { how: "withdrawn", at: now() } }));
    this.changed();
  }

  /**
   * Once a change is made, end each request its thread's resolution or a
   * later message of the spec owner's ended, and let go of what no longer
   * waits. A request whose message the change took back is left as it is,
   * so that bringing the message back brings it back.
   */
  settle(): void {
    const modules = this.modules();
    const at = now();
    let ended = false;
    const records = this.records.map((record) => {
      const held = modules.find(({ id }) => id === record.moduleId);
      const how = held == null ? null : endIn(record, held.store);
      if (how == null) return record;
      ended = true;
      return { ...record, ended: { how, at } };
    });
    if (ended) this.save(records);
    const waiting = new Set(this.waiting().map(({ key }) => key));
    let dropped = ended;
    for (const key of [...this.held.keys(), ...this.failures.keys()]) {
      if (waiting.has(key)) continue;
      dropped = this.held.has(key) || this.failures.has(key) || dropped;
      this.release(key);
      this.failures.delete(key);
    }
    if (dropped) this.changed();
  }

  /** Keep what an agent Requireganizer runs did with a request it has; nothing once it no longer has it. */
  logRun(key: string, agentId: AgentId, entry: RunLogEntry): void {
    if (this.holderOf(key)?.agentId !== agentId) return;
    this.update(key, (record) => ({
      ...record,
      runLogs: record.runLogs.map((log) => (log.until == null ? { ...log, entries: [...log.entries, entry] } : log)),
    }));
  }

  /** The run logs kept with a request, oldest first. */
  runLogs(key: string): RunLog[] {
    return this.records.find(({ id }) => id === key)?.runLogs ?? [];
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
      const request = this.waitingIn(write.moduleId, threadId);
      if (request == null) problems.push(`No change request waits in thread ${threadId}, so no write answers it. Add a message with reply_to_thread instead.`);
      else if (this.holderOf(request.key)?.agentId !== agentId) problems.push(`The change request of thread ${threadId} is not yours, so you may add a message to it but not answer it with changes.`);
    }
    return problems;
  }

  /** The requests other agents have in a stage or in a stage building on it, which a request on that stage itself, given to `agentId`, would make read-only. */
  private madeReadOnly(held: ReturnType<AgentDesk["heldRequests"]>, moduleId: string, stage: string, agentId: AgentId): typeof held {
    const { workflow } = this.module(moduleId).store;
    return held.filter((request) => request.moduleId === moduleId && request.agentId !== agentId && (request.stage === stage || workflow.buildsOn(request.stage, stage)));
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
          return held.filter((request) => request.moduleId === action.moduleId && request.thread.id === action.threadId);
        case "send message": {
          const ended = held.filter((request) => request.moduleId === action.moduleId && action.threadId != null && request.thread.id === action.threadId && request.agentId !== action.to);
          if (action.to == null || action.unitId != null) return ended;
          const readOnly = this.madeReadOnly(held, action.moduleId, action.stage, action.to).filter((request) => !ended.includes(request) && request.thread.id !== action.threadId);
          return [...ended, ...readOnly];
        }
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
        case "give": {
          const given = this.waitingRequest(action.key);
          return makesReadOnly(given) ? this.madeReadOnly(held, given.moduleId, given.stage, action.agentId) : [];
        }
        case "move in history": {
          const waitingAfter = new Set(waitingRequests(action.after, this.records).map(({ key }) => key));
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

  /** Every finding the replies of the open project's modules give, whatever module the item it names is of. */
  private findings(modules: readonly RequestModule[]): FindingView[] {
    return modules.flatMap((module) =>
      module.store.threads.flatMap((thread) =>
        thread.messages.flatMap(({ id, author, at, ...message }) =>
          author.kind !== "agent" ? [] : findingsOf(message).map((finding) => ({ moduleId: module.id, threadId: thread.id, messageId: id, agent: author.name, at, ...finding })),
        ),
      ),
    );
  }

  view(): DeskView {
    const modules = this.modules();
    const held = this.heldRequests();
    const notes = this.records.flatMap((record): RequestNote[] => {
      const withdrawnAt = record.ended?.how === "withdrawn" ? record.ended.at : null;
      if (withdrawnAt == null && record.runLogs.length === 0) return [];
      return [{ key: record.id, moduleId: record.moduleId, threadId: record.threadId, messageId: record.messageId, withdrawnAt, runLogs: record.runLogs.map(({ agent, from, until }) => ({ agent, from, until })) }];
    });
    const asks = modules.flatMap((module) =>
      module.store.workflow.stageIds.flatMap((stage): StageAsks[] => {
        const write = stagesToAskAfter(module, this.records, stage);
        const review = reviewAskProblem(module, this.records, stage) == null;
        return write.length === 0 && !review ? [] : [{ moduleId: module.id, stage, write, review }];
      }),
    );
    return { agents: this.roster.list(), requests: this.waiting().map((request) => this.state(request, held)), notes, findings: this.findings(modules), asks };
  }
}
