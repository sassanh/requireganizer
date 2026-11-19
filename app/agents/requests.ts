import type { Store } from "store";
import type { Thread } from "workflow";

import { type RequestKind, threadAsks } from "./annotations";
import type { RequestRecord } from "./record";

/**
 * A request of the spec owner's to an agent: a change request made by a
 * message of theirs in a thread on a unit or on a stage. A request to write
 * or to review a stage is a change request on that stage, in a thread of its
 * own that it opened.
 */
export interface AgentRequest {
  /** Names this request and no other: a change request made anew by another message of the spec owner's is another request. */
  key: string;
  /** What it asks: what the first message of its thread asked. */
  kind: RequestKind;
  moduleId: string;
  /** The module's name while the project has modules turned on. */
  moduleName: string | null;
  stage: string;
  /** Its thread, the unit the thread is on or null for its stage itself, and the message that made it. */
  thread: { id: string; unitId: string | null; messageId: string };
  /** When the spec owner made it. */
  madeAt: string;
}

/** One module of the open project, as requests are read from it. */
export interface RequestModule {
  id: string;
  name: string | null;
  store: Store;
}

/**
 * The thread a request waits in, in a module as it is; null when it does
 * not wait there: it ended, or its message is not in the module, its
 * thread is resolved, or a later message of the spec owner's made it anew.
 */
function threadWaitingFor(record: RequestRecord, store: Store): Thread | null {
  if (record.ended != null) return null;
  const thread = store.threads.find(({ id }) => id === record.threadId);
  if (thread == null || thread.resolution != null) return null;
  const place = thread.messages.findIndex(({ id }) => id === record.messageId);
  if (place < 0 || thread.messages.slice(place + 1).some(({ author }) => author.kind === "person")) return null;
  return thread;
}

/** How a request that no longer waits in a module as it is ended there; null while it waits, or while its message is not there. */
export function endIn(record: RequestRecord, store: Store): "resolved" | "made anew" | null {
  if (record.ended != null) return null;
  const thread = store.threads.find(({ id }) => id === record.threadId);
  const place = thread?.messages.findIndex(({ id }) => id === record.messageId) ?? -1;
  if (thread == null || place < 0) return null;
  if (thread.messages.slice(place + 1).some(({ author }) => author.kind === "person")) return "made anew";
  return thread.resolution != null ? "resolved" : null;
}

/**
 * Every request that waits in the given modules, in a closed stage too, in
 * the order they were made. The one source of what waits: every view of
 * requests reads it, for the project now or as a move in its history would
 * leave it.
 */
export function waitingRequests(modules: readonly RequestModule[], records: readonly RequestRecord[]): AgentRequest[] {
  return records.flatMap((record): AgentRequest[] => {
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
        madeAt: record.madeAt,
      },
    ];
  });
}

/** A request on a stage itself, which makes that stage and those building on it read-only to every agent but the one that has it. */
export const makesReadOnly = (request: AgentRequest) => request.thread.unitId == null;

/**
 * Of the requests agents have, the request on a stage itself that makes a
 * stage of a module read-only to all agents but its own: one on that stage
 * or on a stage it builds on.
 */
export function readOnlyRequest<Held extends AgentRequest>(held: readonly Held[], store: Store, moduleId: string, stage: string): Held | null {
  return (
    held.find(
      (request) =>
        request.moduleId === moduleId &&
        makesReadOnly(request) &&
        (request.stage === stage || store.workflow.buildsOn(stage, request.stage)),
    ) ?? null
  );
}

/**
 * The stages the spec owner may ask, from a complete stage, to be written:
 * each open stage building on it directly that is not complete, has no
 * request to write it waiting, and has had none answered since the
 * complete stage last became complete.
 */
export function stagesToAskAfter(module: RequestModule, records: readonly RequestRecord[], stage: string): string[] {
  const { store } = module;
  if (!store.stageComplete(stage)) return [];
  const completedAt = store.stageCompletedAt(stage);
  const waiting = waitingRequests([module], records);
  const writeThreads = new Map(store.threads.filter((thread) => thread.unitId == null && threadAsks(thread) === "write").map((thread) => [thread.id, thread.stage]));
  return store.workflow.stagesBuildingOn(stage).filter((later) => {
    if (!store.stageOpen(later) || store.stageComplete(later)) return false;
    if (waiting.some((request) => request.kind === "write" && request.stage === later)) return false;
    // When the complete stage became complete is unknown, as after an import without signature times: the stage may be asked for.
    if (completedAt == null) return true;
    return !records.some(
      (record) => record.moduleId === module.id && record.ended?.how === "answered" && writeThreads.get(record.threadId) === later && record.ended.at > completedAt,
    );
  });
}

/** Why a stage cannot be asked to be written now; null when it can. */
export function writeAskProblem(module: RequestModule, records: readonly RequestRecord[], stage: string): string | null {
  const label = module.store.workflow.stage(stage).label;
  if (!module.store.workflow.stageIds.some((basis) => stagesToAskAfter(module, records, basis).includes(stage))) {
    return `${label} cannot be asked to be written now: it is closed, complete, already asked, or written since what it builds on became complete.`;
  }
  return null;
}

/** Why a stage cannot be asked to be reviewed now; null when it can. */
export function reviewAskProblem(module: RequestModule, records: readonly RequestRecord[], stage: string): string | null {
  const { store } = module;
  const label = store.workflow.stage(stage).label;
  if (!store.stageOpen(stage)) return `${label} is closed.`;
  if (store.itemsOf(stage).length === 0) return `${label} holds no item to review.`;
  if (waitingRequests([module], records).some((request) => request.kind === "review" && request.stage === stage)) return `A request to review ${label} already waits.`;
  return null;
}

/** What the spec owner's message asking for a stage to be written or reviewed says. */
export function askText(kind: "write" | "review", stageLabel: string): string {
  return kind === "write"
    ? `Write ${stageLabel}: write its items following the published rules of each kind of item it holds.`
    : `Review ${stageLabel}: check each of its items against the published rules of its kind, and give a finding for each rule an item breaks.`;
}

/** What a request asks, in one line, such as "Write Requirements" or "Change request on REQ-04". */
export function requestSummary(request: AgentRequest, store: Store): string {
  const stage = store.workflow.isStage(request.stage) ? store.workflow.stage(request.stage).label : request.stage;
  const where = request.moduleName == null ? "" : `${request.moduleName}: `;
  switch (request.kind) {
    case "write":
      return `${where}Write ${stage}`;
    case "review":
      return `${where}Review ${stage}`;
    case "change": {
      const { unitId } = request.thread;
      if (unitId == null) return `${where}Change request on ${stage}`;
      return `${where}Change request on ${store.unitState(unitId) == null ? `a removed unit of ${stage}` : store.unitLabel(unitId)}`;
    }
  }
}

/**
 * What an agent is asked to do with a request given to it, naming the request
 * and the module its reads need as the tools take them.
 */
export function requestPrompt(request: AgentRequest, summary: string): string {
  const where = request.moduleName == null ? "" : ` in module “${request.moduleName}”`;
  const moduleArgument = request.moduleName == null ? "" : ` with module: ${JSON.stringify(request.moduleName)}`;
  const thread = request.thread.id;
  const cannot = `If you cannot answer it, call report_cannot_answer with request: ${JSON.stringify(request.key)}.`;
  switch (request.kind) {
    case "change":
      return `The spec owner gives you a change request${where}: ${summary}. Read thread ${thread} with get_thread${moduleArgument}, then answer it with reply_to_thread${moduleArgument}, or with write_items${moduleArgument} and its answers. ${cannot}`;
    case "write":
      return `The spec owner gives you a request to write a stage${where}: ${summary}. Read thread ${thread} with get_thread${moduleArgument}, the rules of the stage's kinds of item with get_stage_rules (stage ${request.stage}) and the stages it builds on with get_items${moduleArgument}. Write the stage with write_items${moduleArgument}, then answer the thread with a reply, in the answers of your last write or with reply_to_thread. ${cannot}`;
    case "review":
      return `The spec owner gives you a request to review a stage${where}: ${summary}. Read thread ${thread} with get_thread${moduleArgument}, the rules of the stage's kinds of item with get_stage_rules (stage ${request.stage}) and its items with get_items${moduleArgument}. Answer the thread with reply_to_thread${moduleArgument}, giving a finding for each item that breaks a published rule of its kind: the item, the rule as published, and how the item breaks it. ${cannot}`;
  }
}

export type { RequestKind };
