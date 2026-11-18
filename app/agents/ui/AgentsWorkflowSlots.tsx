"use client";

import { Alert, AlertTitle, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { type ReactNode, useMemo } from "react";

import { notify } from "components/notices";
import { getUserFacingErrorMessage } from "lib/errors";
import type { Store } from "store";
import { parseUnitId } from "workflow";
import { type ThreadSendProps, type WorkflowSlots, workflowSlotsContext } from "workflow/ui";

import type { DeskView } from "../desk";
import { changeRequestOf, findingsOf, readOnlyRequest, reviewAskProblem, stagesToAskAfter } from "../requests";
import type { AgentId } from "../roster";
import { type AgentsPageValue, useAgents } from "./context";
import SendButton, { agentWithNoChoice } from "./SendButton";
import { howLongAgo } from "./time";
import { requestStatus } from "./WaitingRequests";
import WorkingSign from "./WorkingSign";

function attempt(request: () => Promise<unknown>, fallback: string): void {
  request().catch((error: unknown) => notify(getUserFacingErrorMessage(error, fallback), "error"));
}

/**
 * The agents a request in a stage can be given to as it is made: the one
 * whose request to write or to review makes the stage read-only, with why,
 * else every available agent.
 */
function agentsFor(view: DeskView, store: Store, moduleId: string, stage: string): { agents: { id: AgentId; name: string }[]; note: string | null } {
  const readOnly = readOnlyRequest(
    view.requests.filter((request) => request.holder != null),
    store,
    moduleId,
    stage,
  );
  const available = view.agents.flatMap((agent) => (agent.name == null ? [] : [{ id: agent.id, name: agent.name }]));
  if (readOnly == null) return { agents: available, note: null };
  const { agentId, name } = readOnly.holder!;
  return { agents: available.filter(({ id }) => id === agentId), note: `Only ${name} can take requests here while it has “${readOnly.summary}”.` };
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
        {...agentsFor(view, store, activeModuleId, later)}
        onSend={(to) => attempt(() => client.askToWrite(activeModuleId, later, to), "The stage could not be asked for.")}
      />
    )),
    ...(reviewable
      ? [
          <SendButton
            key="review"
            label="Ask for a review"
            {...agentsFor(view, store, activeModuleId, stage)}
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

/** Beside a unit's actions: the sign that an agent works on it. */
const UnitRequests = observer(function UnitRequests({ unitId }: { unitId: string }) {
  const { client, view, activeModuleId } = useAgents();
  return <WorkingSign view={view} place={{ kind: "unit", moduleId: activeModuleId, unitId }} onStop={(keys) => attempt(() => client.stopRequests(keys), "The request could not be stopped.")} />;
});

/** Under a unit's content: what answers to requests to review found it breaking. */
const UnitFindings = observer(function UnitFindings({ unitId }: { unitId: string }) {
  const agents = useAgents();
  const store = agents.moduleStore(agents.activeModuleId);
  const address = parseUnitId(unitId);
  const findings = store == null || address.kind !== "item" ? [] : findingsOf(store, agents.requestsOf(agents.activeModuleId), address.itemId);
  return (
    <>
      {findings.map(({ answer, finding }) => (
        <Alert key={`${answer.stage} ${finding.rule}`} severity="warning" variant="outlined" sx={{ mt: 1 }}>
          <AlertTitle>
            Review by {answer.agent} · {howLongAgo(answer.at)}
          </AlertTitle>
          <Typography variant="body2">{finding.how}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
            Rule: {finding.rule}
          </Typography>
        </Alert>
      ))}
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

/** The agents a thread's change request can be given to as its message is sent, with why when fewer than are available. */
function threadChoices(agents: AgentsPageValue, { unitId, threadId }: ThreadSendProps): ReturnType<typeof agentsFor> {
  const store = agents.moduleStore(agents.activeModuleId);
  const stage = store == null ? null : ((unitId == null ? null : store.unitState(unitId)?.stage) ?? store.threads.find(({ id }) => id === threadId)?.stage ?? null);
  return store == null || stage == null ? { agents: [], note: null } : agentsFor(agents.view, store, agents.activeModuleId, stage);
}

/** The thread's send button: it sends the message and gives its change request to the agent chosen, or to none. */
const ThreadSend = observer(function ThreadSend({ label, disabled, ...props }: ThreadSendProps & { label: string; disabled: boolean }) {
  const agents = useAgents();
  return (
    <SendButton
      label={label}
      {...threadChoices(agents, props)}
      disabled={disabled}
      onSend={(to) => attempt(() => sendTo(agents, props.send, to), "The request could not be given.")}
    />
  );
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
      unitNotes: ({ unitId, preview }) => (preview ? null : <UnitFindings unitId={unitId} />),
      thread: ({ threadId, preview }) => (preview ? null : <ThreadRequests threadId={threadId} />),
      send: {
        render: (props) => <ThreadSend {...props} />,
        // The send key does what the send button's main part does.
        submit: (props) =>
          sendTo(agents, props.send, agentWithNoChoice(threadChoices(agents, props).agents)).catch((error: unknown) =>
            notify(getUserFacingErrorMessage(error, "The request could not be given."), "error"),
          ),
      },
    }),
    [agents],
  );
  return <workflowSlotsContext.Provider value={slots}>{children}</workflowSlotsContext.Provider>;
}
