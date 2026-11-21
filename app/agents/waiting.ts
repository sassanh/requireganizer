import type { Store } from "store";
import type { Thread } from "workflow";

import { type AskKind, threadAsks } from "./annotations";
import type { WaitRecord } from "./record";

/**
 * A thread waiting for an agent: from a message of the spec owner's in a
 * thread on a unit or on a stage until the agent that has it replies, or the
 * spec owner withdraws it or resolves the thread. Asking for a stage to be
 * written or reviewed opens a thread of its own on that stage.
 */
export interface WaitingThread {
  /** Names this wait and no other: another message of the spec owner's sets the thread waiting anew, under another key. An agent passes it back. */
  key: string;
  /** What it asks: what the first message of its thread asked. */
  kind: AskKind;
  moduleId: string;
  /** The module's name while the project has modules turned on. */
  moduleName: string | null;
  stage: string;
  /** Its thread, the unit the thread is on or null for its stage itself, and the message that set it waiting. */
  thread: { id: string; unitId: string | null; messageId: string };
  /** When the spec owner's message set it waiting. */
  since: string;
}

/** One module of the open project, as the threads waiting for an agent are read from it. */
export interface ProjectModule {
  id: string;
  name: string | null;
  store: Store;
}

/**
 * The thread a wait is in, in a module as it is; null when it does not wait
 * there: it ended, or its message is not in the module, its thread is
 * resolved, or a later message of the spec owner's set it waiting anew.
 */
function threadWaitingFor(record: WaitRecord, store: Store): Thread | null {
  if (record.ended != null) return null;
  const thread = store.threads.find(({ id }) => id === record.threadId);
  if (thread == null || thread.resolution != null) return null;
  const place = thread.messages.findIndex(({ id }) => id === record.messageId);
  if (place < 0 || thread.messages.slice(place + 1).some(({ author }) => author.kind === "person")) return null;
  return thread;
}

/** How a wait that no longer waits in a module as it is ended there; null while it waits, or while its message is not there. */
export function endIn(record: WaitRecord, store: Store): "resolved" | "set waiting anew" | null {
  if (record.ended != null) return null;
  const thread = store.threads.find(({ id }) => id === record.threadId);
  const place = thread?.messages.findIndex(({ id }) => id === record.messageId) ?? -1;
  if (thread == null || place < 0) return null;
  if (thread.messages.slice(place + 1).some(({ author }) => author.kind === "person")) return "set waiting anew";
  return thread.resolution != null ? "resolved" : null;
}

/**
 * Every thread waiting for an agent in the given modules, in a closed stage
 * too, in the order they were set waiting. The one source of what waits:
 * every view of it reads it, for the project now or as a move in its
 * history would leave it.
 */
export function waitingThreads(modules: readonly ProjectModule[], records: readonly WaitRecord[]): WaitingThread[] {
  return records.flatMap((record): WaitingThread[] => {
    const found = modules.find(({ id }) => id === record.moduleId);
    const thread = found == null ? null : threadWaitingFor(record, found.store);
    if (found == null || thread == null) return [];
    return [
      {
        key: record.id,
        kind: threadAsks(thread),
        moduleId: found.id,
        moduleName: found.name,
        stage: thread.stage,
        thread: { id: thread.id, unitId: thread.unitId, messageId: record.messageId },
        since: record.since,
      },
    ];
  });
}

/** A thread on a stage itself, which while an agent has it makes that stage and those building on it read-only to every other agent. */
export const makesReadOnly = (waiting: WaitingThread) => waiting.thread.unitId == null;

/**
 * Of the threads agents have, the thread on a stage itself that makes a
 * stage of a module read-only to all agents but its own: one on that stage
 * or on a stage it builds on.
 */
export function readOnlyThread<Held extends WaitingThread>(held: readonly Held[], store: Store, moduleId: string, stage: string): Held | null {
  return (
    held.find(
      (waiting) =>
        waiting.moduleId === moduleId &&
        makesReadOnly(waiting) &&
        (waiting.stage === stage || store.workflow.buildsOn(stage, waiting.stage)),
    ) ?? null
  );
}

/**
 * The stages the spec owner may ask, from a complete stage, to be written:
 * each open stage building on it directly that is not complete, has no
 * thread asking to write it waiting for an agent, and has had none answered
 * since the complete stage last became complete.
 */
export function stagesToAskAfter(module: ProjectModule, records: readonly WaitRecord[], stage: string): string[] {
  const { store } = module;
  if (!store.stageComplete(stage)) return [];
  const completedAt = store.stageCompletedAt(stage);
  const waiting = waitingThreads([module], records);
  const writeThreads = new Map(store.threads.filter((thread) => thread.unitId == null && threadAsks(thread) === "write").map((thread) => [thread.id, thread.stage]));
  return store.workflow.stagesBuildingOn(stage).filter((later) => {
    if (!store.stageOpen(later) || store.stageComplete(later)) return false;
    if (waiting.some((thread) => thread.kind === "write" && thread.stage === later)) return false;
    // When the complete stage became complete is unknown, as after an import without signature times: the stage may be asked for.
    if (completedAt == null) return true;
    return !records.some(
      (record) => record.moduleId === module.id && record.ended?.how === "answered" && writeThreads.get(record.threadId) === later && record.ended.at > completedAt,
    );
  });
}

/** Why a stage cannot be asked to be written now; null when it can. */
export function writeAskProblem(module: ProjectModule, records: readonly WaitRecord[], stage: string): string | null {
  const label = module.store.workflow.stage(stage).label;
  if (!module.store.workflow.stageIds.some((basis) => stagesToAskAfter(module, records, basis).includes(stage))) {
    return `${label} cannot be asked to be written now: it is closed, complete, already asked, or written since what it builds on became complete.`;
  }
  return null;
}

/** Why a stage cannot be asked to be reviewed now; null when it can. */
export function reviewAskProblem(module: ProjectModule, records: readonly WaitRecord[], stage: string): string | null {
  const { store } = module;
  const label = store.workflow.stage(stage).label;
  if (!store.stageOpen(stage)) return `${label} is closed.`;
  if (store.itemsOf(stage).length === 0) return `${label} holds no item to review.`;
  if (waitingThreads([module], records).some((thread) => thread.kind === "review" && thread.stage === stage)) return `A thread asking to review ${label} already waits for an agent.`;
  return null;
}

/** What the spec owner's message asking for a stage to be written or reviewed says. */
export function askText(kind: "write" | "review", stageLabel: string): string {
  return kind === "write"
    ? `Write ${stageLabel}: write its items following the published rules of each kind of item it holds.`
    : `Review ${stageLabel}: check each of its items against the published rules of its kind, and give a finding for each rule an item breaks.`;
}

/** What a waiting thread asks, in one line, such as "Write Requirements" or "Thread on REQ-04". */
export function threadSummary(waiting: WaitingThread, store: Store): string {
  const stage = store.workflow.isStage(waiting.stage) ? store.workflow.stage(waiting.stage).label : waiting.stage;
  const where = waiting.moduleName == null ? "" : `${waiting.moduleName}: `;
  switch (waiting.kind) {
    case "write":
      return `${where}Write ${stage}`;
    case "review":
      return `${where}Review ${stage}`;
    case "message": {
      const { unitId } = waiting.thread;
      if (unitId == null) return `${where}Thread on ${stage}`;
      return `${where}Thread on ${store.unitState(unitId) == null ? `a removed unit of ${stage}` : store.unitLabel(unitId)}`;
    }
  }
}

/**
 * What an agent is asked to do with a thread assigned to it, naming the
 * thread, the id it passes back and the module its reads need as the tools
 * take them.
 */
export function assignmentPrompt(waiting: WaitingThread, summary: string): string {
  const where = waiting.moduleName == null ? "" : ` in module “${waiting.moduleName}”`;
  const moduleArgument = waiting.moduleName == null ? "" : ` with module: ${JSON.stringify(waiting.moduleName)}`;
  const thread = waiting.thread.id;
  const cannot = `If you cannot answer it, call report_cannot_answer with id: ${JSON.stringify(waiting.key)}.`;
  switch (waiting.kind) {
    case "message":
      return `The spec owner assigned you a thread${where}: ${summary}. Read thread ${thread} with get_thread${moduleArgument}, then answer the spec owner's last message with reply_to_thread${moduleArgument}, or with write_items${moduleArgument} and its answers. ${cannot}`;
    case "write":
      return `The spec owner assigned you a thread asking to write a stage${where}: ${summary}. Read thread ${thread} with get_thread${moduleArgument}, the rules of the stage's kinds of item with get_stage_rules (stage ${waiting.stage}) and the stages it builds on with get_items${moduleArgument}. Write the stage with write_items${moduleArgument}, then answer the thread with a reply, in the answers of your last write or with reply_to_thread. ${cannot}`;
    case "review":
      return `The spec owner assigned you a thread asking to review a stage${where}: ${summary}. Read thread ${thread} with get_thread${moduleArgument}, the rules of the stage's kinds of item with get_stage_rules (stage ${waiting.stage}) and its items with get_items${moduleArgument}. Answer the thread with reply_to_thread${moduleArgument}, giving a finding for each item that breaks a published rule of its kind: the item, the rule as published, and how the item breaks it. ${cannot}`;
  }
}

export type { AskKind };
