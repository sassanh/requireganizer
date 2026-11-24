import { getSnapshot } from "mobx-state-tree";

import type { AgentId } from "agents/record";
import { UserFacingError } from "lib/errors";
import type { Store } from "store";
import { uuid } from "utilities";
import { removalRevision, revisionOf } from "workflow";

import { threadAsks } from "./annotations";
import {
  type Assignment,
  type AssignmentEnd,
  type DelegationRecord,
  EMPTY_RECORD,
  parseDelegationRecord,
  type ReplyChange,
  type ThreadPlace,
  threadKey,
  type Wait,
  type WaitEnd,
} from "./record";
import { type HeldThread, isHeld, makesReadOnly, type ProjectModule, readOnlyThread, threadSummary, type WaitingThread, waitingThreads } from "./waiting";

/** A thread waiting for an agent as the spec owner sees it. */
export interface WaitingThreadState extends WaitingThread {
  /** What it asks, in one line. */
  summary: string;
  /** Its stage is open; a thread in a closed stage can be assigned once the stage opens. */
  stageOpen: boolean;
}

/** Something besides threads agents have that the spec owner confirms before an action, such as an agent reviewing its own work. */
export interface ConfirmationNote {
  key: string;
  text: string;
}

/**
 * An action of the spec owner's refused until they confirm what it
 * concerns: stopping the agents on the threads it names, and each note.
 */
export class ConfirmationNeededError extends UserFacingError {
  constructor(
    readonly threads: readonly WaitingThreadState[],
    readonly notes: readonly ConfirmationNote[],
  ) {
    super(
      [
        ...(threads.length === 0 ? [] : [`This concerns ${threads.length === 1 ? "a thread an agent has" : "threads agents have"}: ${threads.map(({ summary }) => summary).join("; ")}.`]),
        ...notes.map(({ text }) => text),
      ].join(" "),
    );
    this.name = "ConfirmationNeededError";
  }
}

/**
 * An action of the spec owner's that may concern threads agents have,
 * checked before it is carried out.
 */
export type SpecOwnerAction =
  | { kind: "resolve thread"; moduleId: string; threadId: string }
  /**
   * A message in a thread, or one opening a thread, on a unit or on the
   * stage itself; it sets the thread waiting anew, assigned to `to`, or to
   * none. `asksReview` for a message asking for the stage's review.
   */
  | { kind: "send message"; moduleId: string; stage: string; unitId: string | null; threadId: string | null; to: AgentId | null; asksReview: boolean }
  | { kind: "change items"; moduleId: string; stages: readonly string[] }
  | { kind: "assign"; key: string; agentId: AgentId }
  /** Undo, redo, going to a step or another state shown in place of the project: its modules as the move would leave them. */
  | { kind: "move in history"; after: readonly ProjectModule[] }
  /** Archiving an agent, with what the Agents module asks the spec owner to confirm of it. */
  | { kind: "archive"; agentId: AgentId; asks: readonly ConfirmationNote[] };

/** An agent's write of items, as the threads other agents have may refuse it. */
export interface AgentWrite {
  moduleId: string;
  /** The stages its changes change. */
  stages: readonly string[];
  /** The stages it would close. */
  closes: readonly string[];
  /** The threads it answers with its changes. */
  answers: readonly string[];
}

/** The key of the note on an agent reviewing its own work. */
const OWN_WORK = "review of own work";

/** A stage's items as a change to them is told apart, signatures left out: signing changes no item. */
function itemsOf(store: Store, stage: string): string {
  const node = store.stages.get(stage);
  return node == null ? "[]" : JSON.stringify(getSnapshot(node).items.map(({ id, kind, content, references, dependencies }) => [id, kind, content, references, dependencies]));
}

const now = () => new Date().toISOString();

/**
 * The open project's threads waiting for an agent and the agents that have
 * them, kept beside the project through `keep`, so that no undo, redo or
 * step gone to changes either; with the agent of each module, the item
 * versions agents wrote and the thread each internal agent was started in.
 * Every rule on what waits, who has it and what an action concerns lives
 * here.
 */
export class Desk {
  private record: DelegationRecord = EMPTY_RECORD;
  /** When each assignment's agent was last notified of its thread, and when it last read it, by assignment. */
  private readonly notified = new Map<string, string>();
  private readonly read = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private readonly agentMessageListeners = new Set<(place: ThreadPlace, by: AgentId) => void>();

  constructor(
    /** The open project's modules; none while no project is open. */
    readonly modules: () => readonly ProjectModule[],
    /** Keep the record beside the open project. */
    private readonly keep: (record: DelegationRecord) => void,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  changed(): void {
    for (const listener of this.listeners) listener();
  }

  private save(record: DelegationRecord): void {
    this.record = record;
    this.keep(record);
    this.changed();
  }

  /** A project opened, with what its record keeps. */
  load(value: unknown): void {
    this.record = parseDelegationRecord(value);
    this.notified.clear();
    this.read.clear();
    this.changed();
  }

  get kept(): DelegationRecord {
    return this.record;
  }

  module(moduleId: string): ProjectModule {
    const found = this.modules().find(({ id }) => id === moduleId);
    if (found == null) throw new UserFacingError("That module is no longer open.");
    return found;
  }

  waiting(modules: readonly ProjectModule[] = this.modules()): WaitingThread[] {
    return waitingThreads(modules, this.record);
  }

  held(): HeldThread[] {
    return this.waiting().filter(isHeld);
  }

  waitingThread(key: string): WaitingThread {
    const waiting = this.waiting().find((candidate) => candidate.key === key);
    if (waiting == null) throw new UserFacingError("That thread no longer waits for an agent.");
    return waiting;
  }

  /** The wait of a thread, if it waits for an agent. */
  waitingIn(moduleId: string, threadId: string): WaitingThread | null {
    return this.waiting().find((waiting) => waiting.moduleId === moduleId && waiting.thread.id === threadId) ?? null;
  }

  /** The waiting thread an assignment is for, while the assignment goes on; refused when it ended or is another agent's. */
  requireAssigned(agentId: AgentId, assignmentId: string): HeldThread {
    const held = this.held().find((waiting) => waiting.holder.assignmentId === assignmentId);
    if (held == null || held.holder.agentId !== agentId) throw new UserFacingError("That thread is not assigned to you now, so only the agent it is assigned to can report on it.");
    return held;
  }

  summary(waiting: WaitingThread): string {
    return threadSummary(waiting, this.module(waiting.moduleId).store);
  }

  state(waiting: WaitingThread): WaitingThreadState {
    return { ...waiting, summary: this.summary(waiting), stageOpen: this.module(waiting.moduleId).store.stageOpen(waiting.stage) };
  }

  /** The thread on a stage itself that makes a stage read-only to all but the agent that has it: one on that stage or on a stage it builds on. */
  readOnlyBy(moduleId: string, stage: string, held: readonly HeldThread[] = this.held()): HeldThread | null {
    return readOnlyThread(held, this.module(moduleId).store, moduleId, stage);
  }

  // What the record says of agents and threads.

  /** The agent the spec owner last assigned a thread to; null for a thread never assigned. */
  lastAssigned(place: ThreadPlace): AgentId | null {
    return this.record.assignments.findLast((assignment) => assignment.moduleId === place.moduleId && assignment.threadId === place.threadId)?.agentId ?? null;
  }

  /** The agent that wrote an item version, or proposed its removal, if an agent did. */
  writerOf(itemId: string, revision: string): AgentId | null {
    return this.record.writers.findLast((written) => written.itemId === itemId && written.revision === revision)?.agentId ?? null;
  }

  /**
   * Whether an agent took part in a unit: wrote an item's current version,
   * proposed its removal, wrote the current version of an item a coverage
   * counts toward, or made the change an impact is on, which is its item's
   * current version.
   */
  tookPartIn(agentId: AgentId, store: Store, unitId: string): boolean {
    const state = store.unitState(unitId);
    if (state == null) return false;
    const wrote = (itemId: string) => {
      const version = store.findLinked(itemId)?.version;
      return version != null && this.writerOf(itemId, revisionOf(version)) === agentId;
    };
    if (state.kind === "coverage") return state.referencing.some(wrote);
    if (state.kind === "item" && state.phase === "proposed-removal" && this.writerOf(state.itemId, removalRevision(state.version)) === agentId) return true;
    return wrote(state.itemId);
  }

  /** Whether an agent took part in any item, coverage or impact of a stage. */
  tookPartInAnyOf(agentId: AgentId, store: Store, stage: string): boolean {
    return store.stageUnits(stage).some(({ unitId }) => this.tookPartIn(agentId, store, unitId));
  }

  // Changes of state.

  /** The spec owner's message in a thread set it waiting; whatever waited in the thread before ends. Returns the wait. */
  setWaiting(moduleId: string, threadId: string, messageId: string): Wait {
    const at = now();
    const wait: Wait = { id: uuid(), moduleId, threadId, messageId, since: at, ended: null };
    this.save({
      ...this.record,
      waits: [...this.record.waits.map((kept) => (kept.ended == null && kept.moduleId === moduleId && kept.threadId === threadId ? { ...kept, ended: { how: "set waiting anew" as const, at } } : kept)), wait],
    });
    return wait;
  }

  private endWait(moduleId: string, threadId: string, how: WaitEnd): void {
    const at = now();
    this.save({ ...this.record, waits: this.record.waits.map((wait) => (wait.ended == null && wait.moduleId === moduleId && wait.threadId === threadId ? { ...wait, ended: { how, at } } : wait)) });
  }

  /** Hand a waiting thread no agent has to an agent; what it failed with before is no longer shown. */
  assign(key: string, agentId: AgentId): Assignment {
    const waiting = this.waitingThread(key);
    if (waiting.holder != null) throw new UserFacingError("An agent has that thread. Stop it first.");
    const assignment: Assignment = { id: uuid(), moduleId: waiting.moduleId, threadId: waiting.thread.id, agentId, since: now(), until: null, end: null };
    const { [threadKey({ moduleId: waiting.moduleId, threadId: waiting.thread.id })]: _shown, ...failures } = this.record.failures;
    this.save({ ...this.record, assignments: [...this.record.assignments, assignment], failures });
    return assignment;
  }

  /** End an assignment that goes on. */
  endAssignment(assignmentId: string, end: AssignmentEnd, failure: string | null = null): void {
    const assignment = this.record.assignments.find(({ id }) => id === assignmentId);
    if (assignment == null || assignment.until != null) return;
    const at = now();
    const failures = failure == null ? this.record.failures : { ...this.record.failures, [threadKey(assignment)]: { agentId: assignment.agentId, why: failure, at } };
    this.save({ ...this.record, assignments: this.record.assignments.map((kept) => (kept.id === assignmentId ? { ...kept, until: at, end } : kept)), failures });
  }

  /** The agent that has a thread replied in it: the assignment ends, and the thread no longer waits. */
  answered(moduleId: string, threadId: string): void {
    const held = this.waitingIn(moduleId, threadId);
    if (held?.holder == null) return;
    this.endAssignment(held.holder.assignmentId, "replied");
    this.endWait(moduleId, threadId, "answered");
  }

  /** The spec owner resolved a thread: it no longer waits. */
  resolved(moduleId: string, threadId: string): void {
    this.endWait(moduleId, threadId, "resolved");
  }

  /** Withdraw a thread no agent has from waiting; it shows that it was withdrawn and when. */
  withdraw(key: string): void {
    const waiting = this.waitingThread(key);
    if (waiting.holder != null) throw new UserFacingError("An agent has that thread. Stop it before withdrawing the thread.");
    this.endWait(waiting.moduleId, waiting.thread.id, "withdrawn");
  }

  setModuleAgent(moduleId: string, agentId: AgentId | null): void {
    const { [moduleId]: _cleared, ...moduleAgents } = this.record.moduleAgents;
    this.save({ ...this.record, moduleAgents: agentId == null ? moduleAgents : { ...moduleAgents, [moduleId]: agentId } });
  }

  /** An agent was archived: no module has it as its agent any more. */
  clearModuleAgent(agentId: AgentId): void {
    if (!Object.values(this.record.moduleAgents).includes(agentId)) return;
    this.save({ ...this.record, moduleAgents: Object.fromEntries(Object.entries(this.record.moduleAgents).filter(([, kept]) => kept !== agentId)) });
  }

  startedIn(agentId: AgentId, place: ThreadPlace): void {
    this.save({ ...this.record, startedIn: { ...this.record.startedIn, [agentId]: place } });
  }

  /** The item changes a reply sent with changes made. */
  noteReplyChanges(messageId: string, changes: readonly ReplyChange[]): void {
    if (changes.length === 0) return;
    this.save({ ...this.record, replyChanges: { ...this.record.replyChanges, [messageId]: [...changes] } });
  }

  replyChanges(messageId: string): ReplyChange[] {
    return this.record.replyChanges[messageId] ?? [];
  }

  /** Another agent than the one that has it, if any, added a message to a thread: hear of it to tell the agent that has it. */
  onAgentMessage(listener: (place: ThreadPlace, by: AgentId) => void): () => void {
    this.agentMessageListeners.add(listener);
    return () => this.agentMessageListeners.delete(listener);
  }

  /** An agent added a message to a thread without answering it. */
  agentMessaged(place: ThreadPlace, by: AgentId): void {
    for (const listener of this.agentMessageListeners) listener(place, by);
  }

  /** An agent wrote these item versions. */
  noteWritten(agentId: AgentId, versions: readonly { itemId: string; revision: string }[]): void {
    if (versions.length === 0) return;
    this.save({ ...this.record, writers: [...this.record.writers, ...versions.map((version) => ({ ...version, agentId }))] });
  }

  noteNotified(assignmentId: string): void {
    this.notified.set(assignmentId, now());
  }

  /** An agent read a thread, such as with get_thread: an assignment of it to that thread counts it read now. */
  noteRead(agentId: AgentId, moduleId: string, threadId: string): void {
    const held = this.waitingIn(moduleId, threadId);
    if (held?.holder?.agentId === agentId) this.read.set(held.holder.assignmentId, now());
  }

  /** Whether the agent of an assignment read its thread since it was last notified of it. */
  readSinceNotified(assignmentId: string): boolean {
    const notified = this.notified.get(assignmentId);
    const read = this.read.get(assignmentId);
    return notified != null && read != null && read >= notified;
  }

  // What the threads agents have refuse or ask to confirm.

  /** Why the threads other agents have refuse an agent's write; empty when they do not. */
  writeProblems(agentId: AgentId, write: AgentWrite, labelOf: (agentId: AgentId) => string): string[] {
    const { store } = this.module(write.moduleId);
    const label = (stage: string) => store.workflow.stage(stage).label;
    const held = this.held();
    const problems: string[] = [];
    for (const stage of write.stages) {
      const readOnly = this.readOnlyBy(write.moduleId, stage, held);
      if (readOnly != null && readOnly.holder.agentId !== agentId) {
        problems.push(`${label(stage)} takes changes only from ${labelOf(readOnly.holder.agentId)} while it has “${this.summary(readOnly)}”.`);
      }
    }
    for (const waiting of held) {
      if (waiting.moduleId !== write.moduleId || waiting.holder.agentId === agentId || !write.closes.includes(waiting.stage)) continue;
      problems.push(`This write closes ${label(waiting.stage)}, where ${labelOf(waiting.holder.agentId)} has “${this.summary(waiting)}”.`);
    }
    for (const threadId of write.answers) {
      const waiting = this.waitingIn(write.moduleId, threadId);
      if (waiting?.holder?.agentId !== agentId) problems.push(`Thread ${threadId} is not assigned to you now, so you may add a message to it but not answer it with changes.`);
    }
    return problems;
  }

  /** The threads other agents have in a stage or in a stage building on it, which a thread on that stage itself, assigned to `agentId`, would make read-only. */
  private madeReadOnly(held: readonly HeldThread[], moduleId: string, stage: string, agentId: AgentId): HeldThread[] {
    const { workflow } = this.module(moduleId).store;
    return held.filter((waiting) => waiting.moduleId === moduleId && waiting.holder.agentId !== agentId && (waiting.stage === stage || workflow.buildsOn(waiting.stage, stage)));
  }

  /** The note on an agent reviewing a stage it took part in a unit of; none otherwise. */
  private ownWorkNotes(moduleId: string, stage: string, agentId: AgentId | null, labelOf: (agentId: AgentId) => string): ConfirmationNote[] {
    if (agentId == null || !this.tookPartInAnyOf(agentId, this.module(moduleId).store, stage)) return [];
    return [{ key: OWN_WORK, text: `${labelOf(agentId)} took part in items, coverages or impacts of this stage, so it would review its own work.` }];
  }

  /**
   * What an action of the spec owner's concerns: the threads agents have
   * whose wait it would end or set waiting for another, whose stage it
   * would close, whose read-only stage it would change, that would be in a
   * stage it makes read-only to another agent, or whose agent it archives;
   * and an agent it assigns a review of its own work.
   */
  concernedBy(action: SpecOwnerAction, labelOf: (agentId: AgentId) => string): { threads: HeldThread[]; notes: ConfirmationNote[] } {
    const held = this.held();
    switch (action.kind) {
      case "resolve thread":
        return { threads: held.filter((waiting) => waiting.moduleId === action.moduleId && waiting.thread.id === action.threadId), notes: [] };
      case "send message": {
        const ended = held.filter((waiting) => waiting.moduleId === action.moduleId && action.threadId != null && waiting.thread.id === action.threadId && waiting.holder.agentId !== action.to);
        const readOnly =
          action.to == null || action.unitId != null
            ? []
            : this.madeReadOnly(held, action.moduleId, action.stage, action.to).filter((waiting) => !ended.includes(waiting) && waiting.thread.id !== action.threadId);
        const thread = action.threadId == null ? null : this.module(action.moduleId).store.threads.find(({ id }) => id === action.threadId);
        const review = action.asksReview || (thread != null && thread.unitId == null && threadAsks(thread) === "review");
        return { threads: [...ended, ...readOnly], notes: review ? this.ownWorkNotes(action.moduleId, action.stage, action.to, labelOf) : [] };
      }
      case "change items": {
        const { store } = this.module(action.moduleId);
        const { workflow } = store;
        return {
          threads: held.filter((waiting) => {
            if (waiting.moduleId !== action.moduleId) return false;
            const readOnlyHere = makesReadOnly(waiting) && action.stages.some((stage) => stage === waiting.stage || workflow.buildsOn(stage, waiting.stage));
            const closes = action.stages.some((stage) => store.stageComplete(stage) && workflow.buildsOn(waiting.stage, stage));
            return readOnlyHere || closes;
          }),
          notes: [],
        };
      }
      case "assign": {
        const assigned = this.waitingThread(action.key);
        return {
          threads: makesReadOnly(assigned) ? this.madeReadOnly(held, assigned.moduleId, assigned.stage, action.agentId) : [],
          notes: assigned.kind === "review" ? this.ownWorkNotes(assigned.moduleId, assigned.stage, action.agentId, labelOf) : [],
        };
      }
      case "move in history":
        return {
          threads: held.filter((waiting) => {
            const before = this.module(waiting.moduleId).store;
            const after = action.after.find(({ id }) => id === waiting.moduleId)?.store;
            // The step that set the thread waiting would be taken back.
            const thread = after?.threads.find(({ id }) => id === waiting.thread.id);
            if (after == null || thread == null || !thread.messages.some(({ id }) => id === waiting.thread.messageId)) return true;
            if (before.stageOpen(waiting.stage) && !after.stageOpen(waiting.stage)) return true;
            if (!makesReadOnly(waiting)) return false;
            return before.workflow.stageIds.some((stage) => {
              if (stage !== waiting.stage && !before.workflow.buildsOn(stage, waiting.stage)) return false;
              return itemsOf(before, stage) !== itemsOf(after, stage);
            });
          }),
          notes: [],
        };
      case "archive":
        return { threads: held.filter((waiting) => waiting.holder.agentId === action.agentId), notes: [...action.asks] };
    }
  }

  /**
   * Let an action of the spec owner's be carried out: refused while it
   * concerns what `confirmed` does not name. Returns the threads whose
   * agents are to be stopped for it.
   */
  check(action: SpecOwnerAction, confirmed: readonly string[], labelOf: (agentId: AgentId) => string): HeldThread[] {
    const { threads, notes } = this.concernedBy(action, labelOf);
    if (threads.some(({ key }) => !confirmed.includes(key)) || notes.some(({ key }) => !confirmed.includes(key))) {
      throw new ConfirmationNeededError(threads.map((waiting) => this.state(waiting)), notes);
    }
    return threads;
  }

  /** Every assignment, ended or not, for what threads show of who had them. */
  assignments(): readonly Assignment[] {
    return this.record.assignments;
  }
}
