import type { AgentId } from "agents/record";
import type { AgentView } from "agents/view";

import type { ThreadPlace } from "./record";

/** Whether an agent can be assigned any thread: it has a name and is not archived, a coding agent whether or not it is connected. */
export const availableForEveryThread = (agent: AgentView): boolean => agent.name != null && !agent.archived;

/** What decides whether an agent can take a thread, apart from the agent. */
export interface TakeContext {
  /** The thread, or null for one the assignment opens. */
  thread: ThreadPlace | null;
  stageOpen: boolean;
  stageLabel: string;
  /** The thread on a stage itself, of another agent or of this one, that makes the thread's stage read-only. */
  readOnlyBy: { agentId: AgentId; agentLabel: string; summary: string } | null;
  /** The thread each internal agent was started in. */
  startedIn: Readonly<Record<AgentId, ThreadPlace>>;
}

/**
 * Why an agent cannot take a thread now; null when it can. An internal
 * agent that has no name is available for the thread it was started in
 * only; a thread can be assigned only while its stage is open; and a thread
 * on a read-only stage, or on its units, only to the agent whose thread
 * makes the stage read-only.
 */
export function whyCannotTake(agent: AgentView, context: TakeContext): string | null {
  if (agent.archived) return "It is archived.";
  if (agent.name == null) {
    if (agent.kind === "coding") return "It has no name yet.";
    const started = context.startedIn[agent.id];
    if (context.thread == null || started == null || started.moduleId !== context.thread.moduleId || started.threadId !== context.thread.threadId) {
      return "It was started for another thread and has no name.";
    }
  }
  if (!context.stageOpen) return `${context.stageLabel} is closed, so its threads can be assigned once it opens.`;
  if (context.readOnlyBy != null && context.readOnlyBy.agentId !== agent.id) {
    return `Only ${context.readOnlyBy.agentLabel} can take threads here while it has “${context.readOnlyBy.summary}”.`;
  }
  return null;
}
