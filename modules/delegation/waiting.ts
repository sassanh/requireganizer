import type { AgentId } from "agents/record";
import type { Store } from "store";
import type { Thread } from "workflow";

import { type AskKind, threadAsks } from "./annotations";
import type { DelegationRecord } from "./record";

/**
 * A thread waiting for an agent: from a message of the spec owner's in a
 * thread on a unit or on a stage until the agent that has it replies there,
 * or the spec owner withdraws it or resolves the thread. Asking for a stage
 * to be updated or reviewed opens a thread of its own on that stage.
 */
export interface WaitingThread {
  /** Names this wait and no other: another message of the spec owner's sets the thread waiting anew, under another key. */
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
  /** The agent that has it, by its assignment, and since when; null while no agent has it. */
  holder: { assignmentId: string; agentId: AgentId; since: string } | null;
}

/** A waiting thread an agent has. */
export type HeldThread = WaitingThread & { holder: NonNullable<WaitingThread["holder"]> };

/** One module of the open project, as the threads waiting for an agent are read from it. */
export interface ProjectModule {
  id: string;
  name: string | null;
  store: Store;
}

/**
 * Every thread waiting for an agent in the given modules, in the order they
 * were set waiting, with the agent that has each. Whether a thread waits is
 * the record's alone, which no move in the history changes; a thread the
 * modules do not hold, such as one an undo took away, is not shown.
 */
export function waitingThreads(modules: readonly ProjectModule[], record: DelegationRecord): WaitingThread[] {
  return record.waits.flatMap((wait): WaitingThread[] => {
    if (wait.ended != null) return [];
    const found = modules.find(({ id }) => id === wait.moduleId);
    const thread = found?.store.threads.find(({ id }) => id === wait.threadId);
    if (found == null || thread == null) return [];
    const assignment = record.assignments.find((candidate) => candidate.until == null && candidate.moduleId === wait.moduleId && candidate.threadId === wait.threadId);
    return [
      {
        key: wait.id,
        kind: threadAsks(thread),
        moduleId: found.id,
        moduleName: found.name,
        stage: thread.stage,
        thread: { id: thread.id, unitId: thread.unitId, messageId: wait.messageId },
        since: wait.since,
        holder: assignment == null ? null : { assignmentId: assignment.id, agentId: assignment.agentId, since: assignment.since },
      },
    ];
  });
}

export const isHeld = (waiting: WaitingThread): waiting is HeldThread => waiting.holder != null;

/** A thread on a stage itself, which while an agent has it makes that stage and those building on it read-only to every other agent. */
export const makesReadOnly = (waiting: WaitingThread): boolean => waiting.thread.unitId == null;

/**
 * Of the threads agents have, the thread on a stage itself that makes a
 * stage of a module read-only to all agents but its own: one on that stage
 * or on a stage it builds on, directly or through other stages.
 */
export function readOnlyThread<Held extends HeldThread>(held: readonly Held[], store: Store, moduleId: string, stage: string): Held | null {
  return held.find((waiting) => waiting.moduleId === moduleId && makesReadOnly(waiting) && (waiting.stage === stage || store.workflow.buildsOn(stage, waiting.stage))) ?? null;
}

/** Whether a thread asking for a stage's update or review waits for an agent. */
function updateOrReviewWaits(module: ProjectModule, record: DelegationRecord, stage: string): boolean {
  return waitingThreads([module], record).some((waiting) => waiting.kind !== "message" && waiting.stage === stage);
}

/**
 * The stages the spec owner may ask, in one step from a complete stage, to
 * be updated: each open stage building on it that is not complete, has no
 * thread asking for its update or its review waiting for an agent, and has
 * had no thread asking for its update answered since the complete stage
 * last became complete.
 */
export function stagesToUpdateAfter(module: ProjectModule, record: DelegationRecord, stage: string): string[] {
  const { store } = module;
  if (!store.stageComplete(stage)) return [];
  const completedAt = store.stageCompletedAt(stage);
  const updateThreads = new Map(store.threads.filter((thread) => thread.unitId == null && threadAsks(thread) === "update").map((thread) => [thread.id, thread.stage]));
  return store.workflow.stagesBuildingOn(stage).filter((later) => {
    if (!store.stageOpen(later) || store.stageComplete(later) || updateOrReviewWaits(module, record, later)) return false;
    // When the complete stage became complete is unknown, as after an import without signature times, no answer is known to have come after it.
    if (completedAt == null) return true;
    return !record.waits.some((wait) => wait.moduleId === module.id && wait.ended?.how === "answered" && updateThreads.get(wait.threadId) === later && wait.ended.at > completedAt);
  });
}

/** Why a stage cannot be asked to be updated now; null when it can. */
export function updateAskProblem(module: ProjectModule, record: DelegationRecord, stage: string): string | null {
  const label = module.store.workflow.stage(stage).label;
  if (!module.store.stageOpen(stage)) return `${label} is closed.`;
  if (updateOrReviewWaits(module, record, stage)) return `A thread asking for the update or a review of ${label} already waits for an agent.`;
  return null;
}

/** Why a stage cannot be asked to be reviewed now; null when it can. */
export function reviewAskProblem(module: ProjectModule, record: DelegationRecord, stage: string): string | null {
  const { store } = module;
  const label = store.workflow.stage(stage).label;
  if (!store.stageOpen(stage)) return `${label} is closed.`;
  if (store.stageUnits(stage).length === 0) return `${label} holds nothing to review.`;
  if (updateOrReviewWaits(module, record, stage)) return `A thread asking for the update or a review of ${label} already waits for an agent.`;
  return null;
}

/** Whether a review of a stage asks for a proposal: its definition lets any of its units be signed in a set. */
export function reviewProposes(store: Store, stage: string): boolean {
  const { items, coveragesAndImpacts } = store.workflow.stage(stage).signedInSet;
  return items || coveragesAndImpacts;
}

/** Whether a thread asks for a proposal: a thread asking for the review of a stage whose review proposes. */
export function asksForProposal(store: Store, thread: Thread): boolean {
  return thread.unitId == null && threadAsks(thread) === "review" && reviewProposes(store, thread.stage);
}

/** The rule every agent preparing a proposal follows. */
export const PROPOSAL_RULE =
  "Leave out of the proposal every unit that breaks a published rule that applies to it, giving a finding on it, and every unit that makes a choice the items it rests on leave open to more than one reasonable answer, naming that choice on it; propose every other unit that can be signed in a set.";

/** What the spec owner's message asking for a stage to be updated or reviewed says, a review of a stage whose review proposes asking for a proposal too. */
export function askText(kind: "update" | "review", stageLabel: string, proposes: boolean): string {
  if (kind === "update") {
    return `Update ${stageLabel}: write it from scratch, carry into it what changed in the stages it builds on, or make the change I ask for in this thread, following the published rules of each kind of item it holds.`;
  }
  return proposes
    ? `Review ${stageLabel}: check each of its units against the published rules that apply to it, give a finding for each rule a unit breaks, and propose the units I can sign in one act, naming on each unit you leave out for another reason the choice that is mine to decide.`
    : `Review ${stageLabel}: check each of its units against the published rules that apply to it, and give a finding for each rule a unit breaks.`;
}

/** What a waiting thread asks, in one line, such as "Update Requirements" or "Thread on REQ-04". */
export function threadSummary(waiting: WaitingThread, store: Store): string {
  const stage = store.workflow.isStage(waiting.stage) ? store.workflow.stage(waiting.stage).label : waiting.stage;
  const where = waiting.moduleName == null ? "" : `${waiting.moduleName}: `;
  switch (waiting.kind) {
    case "update":
      return `${where}Update ${stage}`;
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
 * thread, the assignment's id it passes back and the module its calls need.
 */
export function assignmentPrompt(waiting: HeldThread, summary: string, store: Store): string {
  const where = waiting.moduleName == null ? "" : ` in module “${waiting.moduleName}”`;
  const moduleArgument = waiting.moduleName == null ? "" : ` with module: ${JSON.stringify(waiting.moduleName)}`;
  const thread = waiting.thread.id;
  const cannot = `If you cannot answer it, call report_cannot_answer with id: ${JSON.stringify(waiting.holder.assignmentId)}.`;
  switch (waiting.kind) {
    case "message":
      return `The spec owner assigned you a thread${where}: ${summary}. Read thread ${thread} with get_thread${moduleArgument}, then answer the spec owner's last message with reply_to_thread${moduleArgument}, or with write_items${moduleArgument} and its answers. ${cannot}`;
    case "update":
      return `The spec owner assigned you a thread asking to update a stage${where}: ${summary}. Read thread ${thread} with get_thread${moduleArgument}, the rules of the stage's kinds of item with get_stage_rules (stage ${waiting.stage}), its items and those of the stages it builds on with get_items${moduleArgument}. Update the stage with write_items${moduleArgument}, then answer the thread with a reply, in the answers of your last write or with reply_to_thread. ${cannot}`;
    case "review": {
      const read = `The spec owner assigned you a thread asking to review a stage${where}: ${summary}. Read thread ${thread} with get_thread${moduleArgument}, the rules of the stage's kinds of item with get_stage_rules (stage ${waiting.stage}) and its units with get_items${moduleArgument}.`;
      return reviewProposes(store, waiting.stage)
        ? `${read} Answer the thread with reply_to_thread${moduleArgument}, giving findings, choices and a proposal. ${PROPOSAL_RULE} ${cannot}`
        : `${read} Answer the thread with reply_to_thread${moduleArgument}, giving a finding for each unit that breaks a published rule that applies to it: the unit, the rule as published, and how the unit breaks it. ${cannot}`;
    }
  }
}
