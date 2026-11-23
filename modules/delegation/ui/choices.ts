import { type AgentId, agentLabel, type AgentsView, type TemplateView } from "agents";
import type { Store } from "store";

import { availableForEveryThread, type TakeContext, whyCannotTake } from "../availability";
import type { DelegationView, WaitingView } from "../host";
import { threadKey } from "../record";
import { type HeldThread, readOnlyThread } from "../waiting";

/** An agent the spec owner may assign a thread to, with why it cannot take the thread, if it cannot. */
export interface AgentChoice {
  id: AgentId;
  label: string;
  problem: string | null;
}

/** A template a new internal agent can be started from to take the thread, with why none can, if none can. */
export interface TemplateChoice {
  id: string;
  name: string;
  problem: string | null;
}

/**
 * Whom a thread can be assigned to: in one step, the agent the spec owner
 * last assigned it to and the agent of its module; and, when they ask for
 * more, every other agent and a new internal agent from each template.
 */
export interface Choices {
  offered: AgentChoice[];
  others: AgentChoice[];
  templates: TemplateChoice[];
}

/** Where a thread is, or is to be: its module and stage, and the thread once it is open. */
export interface ChoicePlace {
  moduleId: string;
  stage: string;
  threadId: string | null;
}

export const heldThreads = (view: DelegationView): (WaitingView & HeldThread)[] => view.waiting.filter((waiting): waiting is WaitingView & HeldThread => waiting.holder != null);

/** The agents a thread at a place can be assigned to, each with why it cannot take it, if it cannot. */
export function choicesFor(agents: AgentsView, view: DelegationView, store: Store, place: ChoicePlace): Choices {
  const held = heldThreads(view);
  const readOnly = readOnlyThread(held, store, place.moduleId, place.stage);
  const readOnlyHolder = readOnly == null ? null : agents.agents.find(({ id }) => id === readOnly.holder.agentId);
  const context: TakeContext = {
    thread: place.threadId == null ? null : { moduleId: place.moduleId, threadId: place.threadId },
    stageOpen: store.stageOpen(place.stage),
    stageLabel: store.workflow.isStage(place.stage) ? store.workflow.stage(place.stage).label : place.stage,
    readOnlyBy: readOnly == null ? null : { agentId: readOnly.holder.agentId, agentLabel: readOnlyHolder == null ? "another agent" : agentLabel(readOnlyHolder), summary: readOnly.summary },
    startedIn: view.startedIn,
  };
  const choice = (id: AgentId): AgentChoice | null => {
    const agent = agents.agents.find((candidate) => candidate.id === id);
    return agent == null ? null : { id, label: agentLabel(agent), problem: whyCannotTake(agent, context) };
  };
  const lastAssigned = place.threadId == null ? undefined : view.threadAgents[threadKey({ moduleId: place.moduleId, threadId: place.threadId })]?.at(-1);
  const offeredIds = [...new Set([lastAssigned, view.moduleAgents[place.moduleId]].filter((id): id is AgentId => id != null))];
  const offered = offeredIds.flatMap((id) => choice(id) ?? []);
  const startedHere = (id: AgentId) => {
    const started = view.startedIn[id];
    return started != null && place.threadId != null && started.moduleId === place.moduleId && started.threadId === place.threadId;
  };
  const others = agents.agents
    .filter((agent) => !offeredIds.includes(agent.id) && (availableForEveryThread(agent) || (agent.kind === "internal" && agent.name == null && !agent.archived && startedHere(agent.id))))
    .flatMap((agent) => choice(agent.id) ?? []);
  const templateProblem = !context.stageOpen
    ? `${context.stageLabel} is closed, so its threads can be assigned once it opens.`
    : context.readOnlyBy != null
      ? `Only ${context.readOnlyBy.agentLabel} can take threads here while it has “${context.readOnlyBy.summary}”.`
      : null;
  return { offered, others, templates: agents.templates.map((template: TemplateView) => ({ id: template.id, name: template.name, problem: templateProblem })) };
}

/** How many agents are available for every thread. */
export const availableCount = (agents: AgentsView): number => agents.agents.filter(availableForEveryThread).length;
