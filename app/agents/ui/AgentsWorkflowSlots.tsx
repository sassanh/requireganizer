"use client";

import { Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { type ReactNode, useMemo } from "react";

import { notify } from "components/notices";
import { getUserFacingErrorMessage } from "lib/errors";
import type { Store } from "store";
import { parseUnitId } from "workflow";
import { type WorkflowSlots, workflowSlotsContext } from "workflow/ui";

import type { DeskView } from "../desk";
import { changeRequestOf, findingsOf, reviewAskProblem, stagesToAskAfter } from "../requests";
import type { AgentId } from "../roster";
import { type AgentsPageValue, useAgents } from "./context";
import SendButton from "./SendButton";
import { howLongAgo } from "./time";
import { requestStatus } from "./WaitingRequests";
import WorkingSign from "./WorkingSign";

function attempt(request: () => Promise<unknown>, fallback: string): void {
  request().catch((error: unknown) => notify(getUserFacingErrorMessage(error, fallback), "error"));
}

/**
 * The agents a request in a stage can be given to as it is made: the one
 * whose request to write or to review makes the stage read-only, else every
 * available agent.
 */
function agentsFor(view: DeskView, store: Store, moduleId: string, stage: string): { id: AgentId; name: string }[] {
  const readOnly = view.requests.find(
    (request) =>
      request.moduleId === moduleId &&
      request.holder != null &&
      (request.kind === "write" || request.kind === "review") &&
      (request.stage === stage || store.workflow.buildsOn(stage, request.stage)),
  );
  const available = view.agents.flatMap((agent) => (agent.name == null ? [] : [{ id: agent.id, name: agent.name }]));
  return readOnly == null ? available : available.filter(({ id }) => id === readOnly.holder!.agentId);
}

/** Send a message in a thread, then give its change request to `to`, if any. */
async function sendTo(agents: AgentsPageValue, send: () => Promise<string | null>, to: AgentId | null): Promise<void> {
  const threadId = await send();
  if (threadId == null || to == null) return;
  const store = agents.moduleStore(agents.activeModuleId);
  const thread = store?.threads.find(({ id }) => id === threadId);
  const request = thread == null ? null : changeRequestOf({ id: agents.activeModuleId, name: agents.activeModuleName, requests: agents.requestsOf(agents.activeModuleId) }, thread);
  if (request != null) await agents.client.giveRequest(request.key, to);
}

/**
 * Under a stage's header: the requests to write and to review it that
 * wait, with who has each; the sign that an agent works there; and, from a
 * complete stage, a way to ask for the writing of each stage building on it
 * that may be asked, and to ask for a review of the stage.
 */
const StageRequests = observer(function StageRequests({ stage }: { stage: string }) {
  const agents = useAgents();
  const { client, view, activeModuleId, stageLabel } = agents;
  const store = agents.moduleStore(activeModuleId);
  if (store == null) return null;
  const requests = agents.requestsOf(activeModuleId);
  const waiting = view.requests.filter((request) => request.moduleId === activeModuleId && request.stage === stage && request.kind !== "change");
  const askable = stagesToAskAfter(store, requests, stage);
  const reviewable = reviewAskProblem(store, requests, stage) == null;
  const parts: ReactNode[] = [
    ...waiting.map((request) => (
      <Typography key={request.key} variant="body2" color={request.failure == null ? "text.secondary" : "error"}>
        {request.kind === "write" ? "Writing" : "Review"}: {requestStatus(request)}
        {request.failure == null ? "" : ` · ${request.failure}`}
      </Typography>
    )),
    ...askable.map((later) => (
      <SendButton
        key={later}
        label={`Ask for the writing of ${stageLabel(later)}`}
        agents={agentsFor(view, store, activeModuleId, later)}
        onSend={(to) => attempt(() => client.askToWrite(activeModuleId, later, to), "The stage could not be asked for.")}
      />
    )),
    ...(reviewable
      ? [
          <SendButton
            key="review"
            label="Ask for a review"
            agents={agentsFor(view, store, activeModuleId, stage)}
            onSend={(to) => attempt(() => client.askToReview(activeModuleId, stage, to), "The review could not be asked for.")}
          />,
        ]
      : []),
  ];
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
      <WorkingSign view={view} place={{ kind: "stage", moduleId: activeModuleId, stage }} onStop={(keys) => attempt(() => client.stopRequests(keys), "The requests could not be stopped.")} />
      {parts}
    </Stack>
  );
});

/** In a unit's frame: the sign that an agent works on it, and what answers to requests to review found it breaking. */
const UnitRequests = observer(function UnitRequests({ unitId }: { unitId: string }) {
  const agents = useAgents();
  const { client, view, activeModuleId } = agents;
  const store = agents.moduleStore(activeModuleId);
  const address = parseUnitId(unitId);
  const findings = store == null || address.kind !== "item" ? [] : findingsOf(store, agents.requestsOf(activeModuleId), address.itemId);
  return (
    <>
      {findings.map((finding) => (
        <Typography key={finding.rule} variant="caption" color="warning.main" sx={{ display: "block", mr: "auto" }}>
          Breaks “{finding.rule}”: {finding.how}
        </Typography>
      ))}
      <WorkingSign view={view} place={{ kind: "unit", moduleId: activeModuleId, unitId }} onStop={(keys) => attempt(() => client.stopRequests(keys), "The request could not be stopped.")} />
    </>
  );
});

/** Under an open thread's state: whether its change request waits and who has it, and the change requests withdrawn in it. */
const ThreadRequests = observer(function ThreadRequests({ threadId }: { threadId: string }) {
  const agents = useAgents();
  const request = agents.view.requests.find(({ moduleId, thread }) => moduleId === agents.activeModuleId && thread?.id === threadId);
  const notes = agents.requestsOf(agents.activeModuleId).withdrawn.filter((note) => note.threadId === threadId);
  return (
    <>
      {notes.map((note) => (
        <Typography key={`${note.message} ${note.at}`} variant="caption" color="text.secondary">
          Change request withdrawn {howLongAgo(note.at)}
        </Typography>
      ))}
      {request != null && (
        <Typography variant="caption" color={request.failure == null ? "text.secondary" : "error"}>
          {requestStatus(request)}
          {request.failure == null ? "" : ` · ${request.failure}`}
        </Typography>
      )}
    </>
  );
});

/** The thread's send button: it sends the message and gives its change request to the agent chosen, or to none. */
const ThreadSend = observer(function ThreadSend({
  label,
  disabled,
  unitId,
  threadId,
  send,
}: {
  label: string;
  disabled: boolean;
  unitId: string | null;
  threadId: string | null;
  send: () => Promise<string | null>;
}) {
  const agents = useAgents();
  const store = agents.moduleStore(agents.activeModuleId);
  const stage = store == null ? null : ((unitId == null ? null : store.unitState(unitId)?.stage) ?? store.threads.find(({ id }) => id === threadId)?.stage ?? null);
  const choices = store == null || stage == null ? [] : agentsFor(agents.view, store, agents.activeModuleId, stage);
  return <SendButton label={label} agents={choices} disabled={disabled} onSend={(to) => attempt(() => sendTo(agents, send, to), "The request could not be given.")} />;
});

/**
 * The Agents module's parts of the workflow's stage, unit and thread views,
 * filled in the slots the workflow leaves for other modules. Nothing shows
 * in a preview of an earlier state.
 */
export default function AgentsWorkflowSlots({ children }: { children: ReactNode }) {
  const agents = useAgents();
  const slots = useMemo<WorkflowSlots>(
    () => ({
      stage: ({ stage, preview }) => (preview ? null : <StageRequests stage={stage} />),
      unit: ({ unitId, preview }) => (preview ? null : <UnitRequests unitId={unitId} />),
      thread: ({ threadId, preview }) => (preview ? null : <ThreadRequests threadId={threadId} />),
      send: {
        render: (props) => <ThreadSend {...props} />,
        // The send key gives the request to the one agent available, if exactly one is; else to none.
        submit: (send) => {
          const named = agents.view.agents.filter(({ name }) => name != null);
          return sendTo(agents, send, named.length === 1 ? named[0]!.id : null).catch((error: unknown) =>
            notify(getUserFacingErrorMessage(error, "The request could not be given."), "error"),
          );
        },
      },
    }),
    [agents],
  );
  return <workflowSlotsContext.Provider value={slots}>{children}</workflowSlotsContext.Provider>;
}
