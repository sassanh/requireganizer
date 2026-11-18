import type { Store } from "store";
import type { Thread } from "workflow";

import { answersRequest, type ModuleRequests, type StageRequest } from "./section";

/**
 * A request of the spec owner's to an agent: a change request whose thread
 * waits, a request to write a stage, or a request to review one.
 */
export type RequestKind = "change" | "write" | "review";

export interface AgentRequest {
  /** Names this request and no other: a change request made anew by another message of the spec owner's is another request. */
  key: string;
  kind: RequestKind;
  moduleId: string;
  /** The module's name while the project has modules turned on. */
  moduleName: string | null;
  stage: string;
  /** For a change request: its thread, the unit the thread is on, and the place of the message that made it. */
  thread: { id: string; unitId: string; message: number } | null;
  /** When the spec owner made it; null in a project exported without thread times. */
  madeAt: string | null;
}

/** One module of the open project, as requests are read from it: its model and what the Agents module keeps of it. */
export interface RequestModule {
  id: string;
  name: string | null;
  store: Store;
  requests: ModuleRequests;
}

/**
 * The place of the spec owner's message from which a thread's change
 * request waits; null when none waits. One waits from each message of the
 * spec owner's in an open thread until a message that answers it, which
 * only the agent that has it writes, or until the spec owner withdraws it.
 */
export function changeRequestStart(thread: Thread, requests: ModuleRequests): number | null {
  if (thread.resolution != null) return null;
  const start = thread.messages.findLastIndex(({ author }) => author.kind === "person");
  if (start < 0) return null;
  if (thread.messages.slice(start + 1).some(({ annotations }) => answersRequest(annotations))) return null;
  if (requests.withdrawn.some((note) => note.threadId === thread.id && note.message === start)) return null;
  return start;
}

export function changeRequestKey(moduleId: string, threadId: string, start: number): string {
  return `change:${moduleId}:${threadId}:${start}`;
}

export function stageRequestKey(kind: "write" | "review", moduleId: string, request: StageRequest): string {
  return `${kind}:${moduleId}:${request.stage}:${request.at}`;
}

/** The change request that waits in a thread now, if one does. */
export function changeRequestOf(module: Pick<RequestModule, "id" | "name" | "requests">, thread: Thread): AgentRequest | null {
  const start = changeRequestStart(thread, module.requests);
  if (start == null) return null;
  return {
    key: changeRequestKey(module.id, thread.id, start),
    kind: "change",
    moduleId: module.id,
    moduleName: module.name,
    stage: thread.stage,
    thread: { id: thread.id, unitId: thread.unitId, message: start },
    madeAt: thread.messages[start]!.at,
  };
}

function stageRequest(kind: "write" | "review", module: RequestModule, request: StageRequest): AgentRequest {
  return {
    key: stageRequestKey(kind, module.id, request),
    kind,
    moduleId: module.id,
    moduleName: module.name,
    stage: request.stage,
    thread: null,
    madeAt: request.at,
  };
}

/**
 * Every request that waits in the given modules, in a closed stage too:
 * each module's change requests, then its requests to write and to review
 * a stage. The one source of what waits: every view of requests reads it.
 */
export function waitingRequests(modules: readonly RequestModule[]): AgentRequest[] {
  return modules.flatMap((module) => [
    ...module.store.threads.flatMap((thread) => changeRequestOf(module, thread) ?? []),
    ...module.requests.write.map((ask) => stageRequest("write", module, ask)),
    ...module.requests.review.map((ask) => stageRequest("review", module, ask)),
  ]);
}

/**
 * The stages the spec owner may ask, from a complete stage, to be written:
 * each open stage building on it directly that is not complete, has no
 * request to write it waiting, and has had none fulfilled since the
 * complete stage last became complete.
 */
export function stagesToAskAfter(store: Store, requests: ModuleRequests, stage: string): string[] {
  if (!store.stageComplete(stage)) return [];
  const completedAt = store.stageCompletedAt(stage);
  return store.workflow.stagesBuildingOn(stage).filter((later) => {
    if (!store.stageOpen(later) || store.stageComplete(later)) return false;
    if (requests.write.some((ask) => ask.stage === later)) return false;
    const fulfilled = requests.fulfilled.find((done) => done.stage === later);
    // When the complete stage became complete is unknown, as after an import without signature times: the stage may be asked for.
    return fulfilled == null || completedAt == null || fulfilled.at <= completedAt;
  });
}

/** Why a stage cannot be asked to be written now; null when it can. */
export function writeAskProblem(store: Store, requests: ModuleRequests, stage: string): string | null {
  const label = store.workflow.stage(stage).label;
  if (!store.workflow.stageIds.some((basis) => stagesToAskAfter(store, requests, basis).includes(stage))) {
    return `${label} cannot be asked to be written now: it is closed, complete, already asked, or written since what it builds on became complete.`;
  }
  return null;
}

/** Why a stage cannot be asked to be reviewed now; null when it can. */
export function reviewAskProblem(store: Store, requests: ModuleRequests, stage: string): string | null {
  const label = store.workflow.stage(stage).label;
  if (!store.stageOpen(stage)) return `${label} is closed.`;
  if (store.itemsOf(stage).length === 0) return `${label} holds no item to review.`;
  if (requests.review.some((ask) => ask.stage === stage)) return `A request to review ${label} already waits.`;
  return null;
}

/** The findings of answers to requests to review that still show on an item: those made of the item as it is now. */
export function findingsOf(store: Store, requests: ModuleRequests, itemId: string): ModuleRequests["findings"] {
  const revision = store.itemState(itemId)?.revision;
  return revision == null ? [] : requests.findings.filter((finding) => finding.itemId === itemId && finding.revision === revision);
}

/** What a request asks, in one line, such as "Write Requirements" or "Change request on REQ-04". */
export function requestSummary(request: AgentRequest, store: Store): string {
  const stage = store.workflow.isStage(request.stage) ? store.workflow.stage(request.stage).label : request.stage;
  const where = request.moduleName == null ? "" : `${request.moduleName}: `;
  switch (request.kind) {
    case "change": {
      const unit = request.thread == null ? stage : store.unitState(request.thread.unitId) == null ? `a removed unit of ${stage}` : store.unitLabel(request.thread.unitId);
      return `${where}Change request on ${unit}`;
    }
    case "write":
      return `${where}Write ${stage}`;
    case "review":
      return `${where}Review ${stage}`;
  }
}

export type { StageRequest };
