import { getSnapshot } from "mobx-state-tree";

import { UserFacingError } from "lib/errors";
import { uuid } from "utilities";

import { findingsOf } from "./annotations";
import { parseWaitRecords, type RunLog, type RunLogEntry, type WaitRecord } from "./record";
import type { AgentId, AgentRoster, AgentView } from "./roster";
import {
  endIn,
  makesReadOnly,
  type ProjectModule,
  readOnlyThread,
  reviewAskProblem,
  stagesToAskAfter,
  threadSummary,
  type WaitingThread,
  waitingThreads,
} from "./waiting";

/** What an agent is told of a thread: that it was assigned to it, or that it was stopped working on it. */
export type AgentNotice =
  | { type: "assigned"; waiting: WaitingThread; summary: string }
  | { type: "stopped"; waiting: WaitingThread; summary: string };

/** A thread waiting for an agent as the spec owner sees it. */
export interface WaitingThreadState extends WaitingThread {
  /** What it asks, in one line. */
  summary: string;
  /** The agent that has it and since when; null while no agent has it. */
  holder: { agentId: AgentId; name: string; since: string } | null;
  /** Why the agent it was last assigned to failed to answer it, until it is assigned again. */
  failure: string | null;
  /** The agents it can be assigned to now: none while an agent has it or its stage is closed. */
  assignableTo: AgentId[];
  /** Its stage is open; a thread in a closed stage can be assigned once the stage opens. */
  stageOpen: boolean;
}

/** What a thread shows of a wait in it beside its messages: that it was withdrawn and when, and the run logs kept with it. */
export interface WaitNote {
  key: string;
  moduleId: string;
  threadId: string;
  /** The message that set the thread waiting. */
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

/** The agents, the threads waiting for an agent, what threads and items show of them, and what each stage may ask for, as the page shows them. */
export interface DeskView {
  agents: AgentView[];
  waiting: WaitingThreadState[];
  notes: WaitNote[];
  findings: FindingView[];
  asks: StageAsks[];
}

/**
 * An action of the spec owner's that may concern threads agents have, asked
 * about before it is carried out.
 */
export type SpecOwnerAction =
  | { kind: "resolve thread"; moduleId: string; threadId: string }
  /**
   * A message in a thread, or one opening a thread, on a unit or on the
   * stage itself; it sets the thread waiting anew, assigned to `to`, or to none.
   */
  | { kind: "send message"; moduleId: string; stage: string; unitId: string | null; threadId: string | null; to: AgentId | null }
  | { kind: "change items"; moduleId: string; stages: readonly string[] }
  | { kind: "assign"; key: string; agentId: AgentId }
  /** Undo, redo or going to a step: the modules as the move would leave them. */
  | { kind: "move in history"; after: readonly ProjectModule[] };

/** An agent's write of items, as the threads agents have may refuse it. */
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
 * An action of the spec owner's refused because it concerns threads agents
 * have: carried out once the spec owner confirms stopping those agents.
 */
export class ThreadsConcernedError extends UserFacingError {
  constructor(readonly threads: WaitingThreadState[]) {
    super(`This concerns ${threads.length === 1 ? "a thread an agent has" : "threads agents have"}: ${threads.map(({ summary }) => summary).join("; ")}. Stop ${threads.length === 1 ? "that agent" : "those agents"} first.`);
    this.name = "ThreadsConcernedError";
  }
}

/** A stage's items as a change to them is told apart, signatures left out: signing changes no item. */
function itemsOf(store: ProjectModule["store"], stage: string): string {
  const node = store.stages.get(stage);
  return node == null ? "[]" : JSON.stringify(getSnapshot(node).items.map(({ id, kind, content, references, dependencies }) => [id, kind, content, references, dependencies]));
}

const now = () => new Date().toISOString();

/**
 * The open project's threads waiting for an agent: the message that set
 * each wait, how it ended and its run logs, kept beside the project through
 * `keep`, which no undo, redo or step gone to moves; and which agent has
 * each, kept in memory only, so a project that opens has every waiting
 * thread no agent's. Whether a thread waits is read from the record and the
 * modules each time.
 */
export class AgentDesk {
  private records: WaitRecord[] = [];
  private readonly held = new Map<string, { agentId: AgentId; since: string }>();
  private readonly failures = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private readonly noticeListeners = new Set<(agentId: AgentId, notice: AgentNotice) => void>();

  constructor(
    readonly roster: AgentRoster,
    /** The open project's modules; none while no project is open. */
    private readonly modules: () => readonly ProjectModule[],
    /** Keep the waits beside the open project. */
    private readonly keep: (records: readonly WaitRecord[]) => void,
  ) {
    roster.subscribe(() => this.releaseUnavailable());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Hear of each thread assigned to an agent and of each agent stopped, for the agent to be told. */
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
  private save(records: WaitRecord[]): void {
    this.records = records;
    this.keep(records);
  }

  private update(key: string, change: (record: WaitRecord) => WaitRecord): void {
    this.save(this.records.map((record) => (record.id === key ? change(record) : record)));
  }

  /** The wait's run log open now, if one is, closed. */
  private closeRunLog(key: string): void {
    const record = this.records.find(({ id }) => id === key);
    if (record == null || !record.runLogs.some(({ until }) => until == null)) return;
    const at = now();
    this.update(key, (found) => ({ ...found, runLogs: found.runLogs.map((log) => (log.until == null ? { ...log, until: at } : log)) }));
  }

  /** No agent has the thread any more. */
  private release(key: string): void {
    this.held.delete(key);
    this.closeRunLog(key);
  }

  /** An agent that is no longer available has no thread; its run logs end. */
  private releaseUnavailable(): void {
    for (const [key, { agentId }] of [...this.held]) if (!this.roster.isAvailable(agentId)) this.release(key);
    this.changed();
  }

  /**
   * The project opened, with the waits its record kept: every thread waiting
   * for an agent is no agent's, and a run log still open ends with its last
   * entry.
   */
  load(value: unknown): void {
    this.held.clear();
    this.failures.clear();
    this.records = parseWaitRecords(value).map((record) => ({
      ...record,
      runLogs: record.runLogs.map((log) => (log.until == null ? { ...log, until: log.entries.at(-1)?.at ?? log.from } : log)),
    }));
    this.changed();
  }

  private module(moduleId: string): ProjectModule {
    const found = this.modules().find(({ id }) => id === moduleId);
    if (found == null) throw new UserFacingError("That module is no longer open.");
    return found;
  }

  /** The waits of the open project, ended or not. */
  waitRecords(): readonly WaitRecord[] {
    return this.records;
  }

  waiting(): WaitingThread[] {
    return waitingThreads(this.modules(), this.records);
  }

  private waitingThread(key: string): WaitingThread {
    const waiting = this.waiting().find((candidate) => candidate.key === key);
    if (waiting == null) throw new UserFacingError("That thread no longer waits for an agent.");
    return waiting;
  }

  /** The wait of a thread, if it waits for an agent. */
  waitingIn(moduleId: string, threadId: string): WaitingThread | null {
    return this.waiting().find((waiting) => waiting.moduleId === moduleId && waiting.thread.id === threadId) ?? null;
  }

  /** The waiting thread with this key that an agent has; refused when it no longer waits or another agent has it. */
  requireHeld(agentId: AgentId, key: string): WaitingThread {
    const waiting = this.waitingThread(key);
    if (this.holderOf(key)?.agentId !== agentId) throw new UserFacingError("That thread is not assigned to you, so only the agent it is assigned to can answer it.");
    return waiting;
  }

  summary(waiting: WaitingThread): string {
    return threadSummary(waiting, this.module(waiting.moduleId).store);
  }

  /** The agent that has a waiting thread and since when; null while no agent has it. */
  holderOf(key: string): { agentId: AgentId; since: string } | null {
    const holding = this.held.get(key);
    return holding == null || !this.roster.isAvailable(holding.agentId) ? null : holding;
  }

  /** Every waiting thread an agent has. */
  heldThreads(): (WaitingThread & { agentId: AgentId; since: string })[] {
    return this.waiting().flatMap((waiting) => {
      const holding = this.holderOf(waiting.key);
      return holding == null ? [] : [{ ...waiting, ...holding }];
    });
  }

  /** The thread on a stage itself that makes a stage read-only to all but the agent that has it: one on that stage or on a stage it builds on. */
  readOnlyBy(moduleId: string, stage: string, held = this.heldThreads()): (WaitingThread & { agentId: AgentId }) | null {
    return readOnlyThread(held, this.module(moduleId).store, moduleId, stage);
  }

  /** The agents a waiting thread can be assigned to now. */
  assignableTo(waiting: WaitingThread, held = this.heldThreads()): AgentId[] {
    if (this.holderOf(waiting.key) != null) return [];
    const { store } = this.module(waiting.moduleId);
    if (!store.stageOpen(waiting.stage)) return [];
    const readOnly = this.readOnlyBy(waiting.moduleId, waiting.stage, held);
    const available = this.roster.available().map(({ id }) => id);
    return readOnly == null ? available : available.filter((id) => id === readOnly.agentId);
  }

  /**
   * A thread in a stage of a module may be assigned to an agent: the agent
   * is available, the stage is open, and no other agent's thread on a stage
   * itself makes the stage read-only.
   */
  requireAssignable(moduleId: string, stage: string, agentId: AgentId): void {
    if (this.roster.nameOf(agentId) == null) throw new UserFacingError("That agent is no longer available.");
    const { store } = this.module(moduleId);
    if (!store.stageOpen(stage)) throw new UserFacingError(`${store.workflow.stage(stage).label} is closed, so its threads can be assigned once it opens.`);
    const readOnly = this.readOnlyBy(moduleId, stage);
    if (readOnly != null && readOnly.agentId !== agentId) {
      throw new UserFacingError(`${this.summary(readOnly)} is with ${this.roster.nameOf(readOnly.agentId)}, so this thread can be assigned to that agent only.`);
    }
  }

  /** The spec owner's message `messageId` in a thread set it waiting; returns the wait's key. Whatever waited in the thread before ends once settled. */
  setWaiting(moduleId: string, threadId: string, messageId: string): string {
    const record: WaitRecord = { id: uuid(), moduleId, threadId, messageId, since: now(), ended: null, runLogs: [] };
    this.save([...this.records, record]);
    this.changed();
    return record.id;
  }

  /**
   * Assign a waiting thread no agent has to an available agent. Refused for
   * a thread whose stage is closed, for a unit or stage another agent's
   * thread on a stage itself makes read-only, and while threads of other
   * agents would be made read-only by it: the spec owner stops those first.
   */
  assign(key: string, agentId: AgentId): void {
    const waiting = this.waitingThread(key);
    const holder = this.holderOf(key);
    if (holder != null) throw new UserFacingError(`${this.roster.nameOf(holder.agentId)} has that thread. Stop it first.`);
    this.requireAssignable(waiting.moduleId, waiting.stage, agentId);
    const name = this.roster.nameOf(agentId)!;
    const concerned = this.concernedBy({ kind: "assign", key, agentId });
    if (concerned.length > 0) {
      throw new UserFacingError(`Stop first the agents working there: ${concerned.map(({ summary }) => summary).join("; ")}.`);
    }
    const since = now();
    this.held.set(key, { agentId, since });
    this.failures.delete(key);
    // What an agent Requireganizer runs does with the thread is kept with it from now on.
    if (this.roster.runAgent(agentId) != null) {
      this.update(key, (record) => ({ ...record, runLogs: [...record.runLogs, { agent: name, from: since, until: null, entries: [] }] }));
    }
    this.changed();
    this.notify(agentId, { type: "assigned", waiting, summary: this.summary(waiting) });
  }

  /** Stop the agent working on a thread, which is told so; the thread still waits for an agent. */
  stop(key: string): void {
    const holder = this.holderOf(key);
    this.release(key);
    if (holder == null) return;
    this.changed();
    const waiting = this.waiting().find((candidate) => candidate.key === key);
    if (waiting != null) this.notify(holder.agentId, { type: "stopped", waiting, summary: this.summary(waiting) });
  }

  stopAll(keys: readonly string[]): void {
    for (const key of keys) this.stop(key);
  }

  /**
   * The agent that has a thread failed to answer it, such as when its AI
   * provider failed or it reported it cannot: the thread is no agent's and
   * still waits, shown with why until it is assigned again.
   */
  fail(key: string, agentId: AgentId, why: string): void {
    const holder = this.holderOf(key);
    if (holder?.agentId !== agentId) throw new UserFacingError("That thread is not assigned to you, so only the agent it is assigned to can report it.");
    if (why.trim().length === 0) throw new UserFacingError("Say why the thread cannot be answered.");
    this.release(key);
    this.failures.set(key, why.trim());
    this.changed();
  }

  /** The agent that has a thread replied in it: it no longer waits, and no agent has it. */
  answered(key: string): void {
    this.release(key);
    this.update(key, (record) => ({ ...record, ended: { how: "answered", at: now() } }));
    this.changed();
  }

  /**
   * Withdraw a thread no agent has from waiting for an agent: it no longer
   * waits, and it shows that it was withdrawn and when. The project does not
   * change.
   */
  withdraw(key: string): void {
    this.waitingThread(key);
    const holder = this.holderOf(key);
    if (holder != null) throw new UserFacingError(`${this.roster.nameOf(holder.agentId)} has that thread. Stop it before withdrawing the thread.`);
    this.failures.delete(key);
    this.update(key, (record) => ({ ...record, ended: { how: "withdrawn", at: now() } }));
    this.changed();
  }

  /**
   * Once a change is made, end each wait its thread's resolution or a later
   * message of the spec owner's ended, and let go of what no longer waits.
   * A wait whose message the change took back is left as it is, so that
   * bringing the message back brings it back.
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

  /** Keep what an agent Requireganizer runs did with a thread it has; nothing once it no longer has it. */
  logRun(key: string, agentId: AgentId, entry: RunLogEntry): void {
    if (this.holderOf(key)?.agentId !== agentId) return;
    this.update(key, (record) => ({
      ...record,
      runLogs: record.runLogs.map((log) => (log.until == null ? { ...log, entries: [...log.entries, entry] } : log)),
    }));
  }

  /** The run logs kept with a wait, oldest first. */
  runLogs(key: string): RunLog[] {
    return this.records.find(({ id }) => id === key)?.runLogs ?? [];
  }

  /** Why the threads other agents have refuse an agent's write; empty when they do not. */
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
    for (const waiting of this.heldThreads()) {
      if (waiting.moduleId !== write.moduleId || waiting.agentId === agentId || !write.closes.includes(waiting.stage)) continue;
      problems.push(`This write closes ${label(waiting.stage)}, where ${this.roster.nameOf(waiting.agentId)} has “${this.summary(waiting)}”.`);
    }
    for (const threadId of write.answers) {
      const waiting = this.waitingIn(write.moduleId, threadId);
      if (waiting == null) problems.push(`Thread ${threadId} does not wait for an agent, so no write answers it. Add a message with reply_to_thread instead.`);
      else if (this.holderOf(waiting.key)?.agentId !== agentId) problems.push(`Thread ${threadId} is not assigned to you, so you may add a message to it but not answer it with changes.`);
    }
    return problems;
  }

  /** The threads other agents have in a stage or in a stage building on it, which a thread on that stage itself, assigned to `agentId`, would make read-only. */
  private madeReadOnly(held: ReturnType<AgentDesk["heldThreads"]>, moduleId: string, stage: string, agentId: AgentId): typeof held {
    const { workflow } = this.module(moduleId).store;
    return held.filter((waiting) => waiting.moduleId === moduleId && waiting.agentId !== agentId && (waiting.stage === stage || workflow.buildsOn(waiting.stage, stage)));
  }

  /**
   * The threads agents have whose wait an action of the spec owner's would
   * end, whose stage it would close, whose read-only stage it would change,
   * or that would be in a stage it makes read-only to another agent: the
   * spec owner confirms stopping those agents before it is carried out.
   */
  concernedBy(action: SpecOwnerAction): WaitingThreadState[] {
    const held = this.heldThreads();
    const concerned = (() => {
      switch (action.kind) {
        case "resolve thread":
          return held.filter((waiting) => waiting.moduleId === action.moduleId && waiting.thread.id === action.threadId);
        case "send message": {
          const ended = held.filter((waiting) => waiting.moduleId === action.moduleId && action.threadId != null && waiting.thread.id === action.threadId && waiting.agentId !== action.to);
          if (action.to == null || action.unitId != null) return ended;
          const readOnly = this.madeReadOnly(held, action.moduleId, action.stage, action.to).filter((waiting) => !ended.includes(waiting) && waiting.thread.id !== action.threadId);
          return [...ended, ...readOnly];
        }
        case "change items": {
          const { store } = this.module(action.moduleId);
          const { workflow } = store;
          return held.filter((waiting) => {
            if (waiting.moduleId !== action.moduleId) return false;
            const readOnlyHere = makesReadOnly(waiting) && action.stages.some((stage) => stage === waiting.stage || workflow.buildsOn(stage, waiting.stage));
            const closes = action.stages.some((stage) => store.stageComplete(stage) && workflow.buildsOn(waiting.stage, stage));
            return readOnlyHere || closes;
          });
        }
        case "assign": {
          const assigned = this.waitingThread(action.key);
          return makesReadOnly(assigned) ? this.madeReadOnly(held, assigned.moduleId, assigned.stage, action.agentId) : [];
        }
        case "move in history": {
          const waitingAfter = new Set(waitingThreads(action.after, this.records).map(({ key }) => key));
          return held.filter((waiting) => {
            const before = this.module(waiting.moduleId).store;
            const after = action.after.find(({ id }) => id === waiting.moduleId)?.store;
            if (after == null || !waitingAfter.has(waiting.key)) return true;
            if (before.stageOpen(waiting.stage) && !after.stageOpen(waiting.stage)) return true;
            if (!makesReadOnly(waiting)) return false;
            return before.workflow.stageIds.some((stage) => {
              if (stage !== waiting.stage && !before.workflow.buildsOn(stage, waiting.stage)) return false;
              return itemsOf(before, stage) !== itemsOf(after, stage);
            });
          });
        }
      }
    })();
    return concerned.map((waiting) => this.state(waiting, held));
  }

  private state(waiting: WaitingThread, held: ReturnType<AgentDesk["heldThreads"]>): WaitingThreadState {
    const holding = this.holderOf(waiting.key);
    return {
      ...waiting,
      summary: this.summary(waiting),
      holder: holding == null ? null : { ...holding, name: this.roster.nameOf(holding.agentId)! },
      failure: this.failures.get(waiting.key) ?? null,
      assignableTo: this.assignableTo(waiting, held),
      stageOpen: this.module(waiting.moduleId).store.stageOpen(waiting.stage),
    };
  }

  /**
   * Let an action of the spec owner's be carried out: refused while it
   * concerns threads agents have, unless `stopping` names each of them,
   * whose agents are then stopped.
   */
  clear(action: SpecOwnerAction, stopping: readonly string[] = []): void {
    const concerned = this.concernedBy(action);
    const unconfirmed = concerned.filter(({ key }) => !stopping.includes(key));
    if (unconfirmed.length > 0) throw new ThreadsConcernedError(concerned);
    this.stopAll(concerned.map(({ key }) => key));
  }

  /** Every finding the replies of the open project's modules give, whatever module the item it names is of. */
  private findings(modules: readonly ProjectModule[]): FindingView[] {
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
    const held = this.heldThreads();
    const notes = this.records.flatMap((record): WaitNote[] => {
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
    return { agents: this.roster.list(), waiting: this.waiting().map((waiting) => this.state(waiting, held)), notes, findings: this.findings(modules), asks };
  }
}
