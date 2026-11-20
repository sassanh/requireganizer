"use client";

import { Alert, AlertTitle, Button, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { type ReactNode, useMemo, useState } from "react";

import { notify } from "components/notices";
import { getUserFacingErrorMessage } from "lib/errors";
import type { Store } from "store";
import { parseUnitId, revisionOf } from "workflow";
import { ItemChip, type ThreadSendProps, type WorkflowSlots, workflowSlotsContext } from "workflow/ui";

import type { DeskView, FindingView } from "../desk";
import { readOnlyRequest } from "../requests";
import type { AgentId } from "../roster";
import { type AgentsPageValue, useAgents } from "./context";
import RunLogDialog from "./RunLogDialog";
import SendButton, { agentWithNoChoice } from "./SendButton";
import { howLongAgo } from "./time";
import { requestStatus } from "./WaitingRequests";
import WorkingSign from "./WorkingSign";

function attempt(request: () => Promise<unknown>, fallback: string): void {
  request().catch((error: unknown) => notify(getUserFacingErrorMessage(error, fallback), "error"));
}

/**
 * The agents a request in a stage can be given to as it is made: the one
 * whose request on a stage itself makes the stage read-only, with why, else
 * every available agent.
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

/** Send a message in a thread, giving its change request to `to`, or to none, in the same act. */
async function sendTo(agents: AgentsPageValue, send: () => Promise<string | null>, to: AgentId | null): Promise<void> {
  await agents.withRequestGivenTo(to, send);
}

/**
 * Under a stage's header: the sign that an agent works there and, from a
 * complete stage, a way to ask for the writing of each stage building on it
 * that may be asked, and to ask for a review of the stage. Each request is
 * made in a thread of its own on the stage it asks for.
 */
const StageRequests = observer(function StageRequests({ stage }: { stage: string }) {
  const agents = useAgents();
  const { client, view, activeModuleId, stageLabel } = agents;
  const store = agents.moduleStore(activeModuleId);
  if (store == null) return null;
  const asks = view.asks.find((entry) => entry.moduleId === activeModuleId && entry.stage === stage);
  const parts: ReactNode[] = [
    ...(asks?.write ?? []).map((later) => (
      <SendButton
        key={later}
        label={`Write ${stageLabel(later)}`}
        {...agentsFor(view, store, activeModuleId, later)}
        onSend={(to) => attempt(() => client.askToWrite(activeModuleId, later, to), "The stage could not be asked for.")}
      />
    )),
    ...(asks?.review === true
      ? [
          <SendButton
            key="review"
            label="Review"
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

/** Whether the item a finding names changed since the finding was given; false once the item is gone. */
function changedSince(store: Store, finding: FindingView): boolean {
  const version = store.findLinked(finding.itemId)?.version;
  return version != null && revisionOf(version) !== finding.revision;
}

/** Under an item's content: the findings agents' replies give on it while it is as it was when each was given. */
const UnitFindings = observer(function UnitFindings({ unitId }: { unitId: string }) {
  const agents = useAgents();
  const store = agents.moduleStore(agents.activeModuleId);
  const address = parseUnitId(unitId);
  const findings =
    store == null || address.kind !== "item"
      ? []
      : agents.view.findings.filter((finding) => finding.itemId === address.itemId && !changedSince(store, finding));
  return (
    <>
      {findings.map((finding) => (
        <Alert key={`${finding.messageId} ${finding.rule}`} severity="warning" variant="outlined" sx={{ mt: 1 }}>
          <AlertTitle>
            Finding by {finding.agent}
            {finding.at == null ? "" : ` · ${howLongAgo(finding.at)}`}
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

/** Under an open thread's state: whether its change request waits and who has it. */
const ThreadRequests = observer(function ThreadRequests({ threadId }: { threadId: string }) {
  const agents = useAgents();
  const request = agents.view.requests.find(({ moduleId, thread }) => moduleId === agents.activeModuleId && thread.id === threadId);
  if (request == null) return null;
  return (
    <Typography variant="caption" color={request.failure == null ? "text.secondary" : "error"}>
      {requestStatus(request)}
      {request.failure == null ? "" : ` · ${request.failure}`}
    </Typography>
  );
});

/**
 * Under a thread message: the findings it gives, each item as a marked
 * mention shows it, marked once the item changed since; and, under a
 * message of the spec owner's that made a request, that the request was
 * withdrawn and when, and a way to open each run log kept with it.
 */
const MessageNotes = observer(function MessageNotes({ threadId, messageId }: { threadId: string; messageId: string }) {
  const agents = useAgents();
  const [runLog, setRunLog] = useState<{ key: string; index: number } | null>(null);
  const store = agents.moduleStore(agents.activeModuleId);
  const findings = agents.view.findings.filter((finding) => finding.moduleId === agents.activeModuleId && finding.messageId === messageId);
  const notes = agents.view.notes.filter((note) => note.moduleId === agents.activeModuleId && note.threadId === threadId && note.messageId === messageId);
  if (findings.length === 0 && notes.length === 0) return null;
  return (
    <Stack spacing={0.75} sx={{ mt: 0.5 }}>
      {findings.map((finding) => (
        <Stack key={`${finding.itemId} ${finding.rule}`} spacing={0.25} sx={{ pl: 1, borderLeft: 2, borderColor: "warning.main" }}>
          <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <ItemChip itemId={finding.itemId} />
            {store != null && changedSince(store, finding) && (
              <Typography variant="caption" color="text.secondary">
                changed since this finding
              </Typography>
            )}
          </Stack>
          <Typography variant="body2">{finding.how}</Typography>
          <Typography variant="caption" color="text.secondary">
            Rule: {finding.rule}
          </Typography>
        </Stack>
      ))}
      {notes.map((note) => (
        <Stack key={note.key} spacing={0.25} sx={{ alignItems: "flex-start" }}>
          {note.runLogs.map((log, index) => (
            <Button key={index} size="small" variant="text" onClick={() => setRunLog({ key: note.key, index })}>
              Run log: {log.agent}, {new Date(log.from).toLocaleString()} – {log.until == null ? "has it now" : new Date(log.until).toLocaleString()}
            </Button>
          ))}
          {note.withdrawnAt != null && (
            <Typography variant="caption" color="text.secondary">
              Change request withdrawn {howLongAgo(note.withdrawnAt)}
            </Typography>
          )}
        </Stack>
      ))}
      {runLog != null && <RunLogDialog requestKey={runLog.key} index={runLog.index} onClose={() => setRunLog(null)} />}
    </Stack>
  );
});

/** The agents a thread's change request can be given to as its message is sent, with why when fewer than are available. */
function threadChoices(agents: AgentsPageValue, { stage }: ThreadSendProps): ReturnType<typeof agentsFor> {
  const store = agents.moduleStore(agents.activeModuleId);
  return store == null ? { agents: [], note: null } : agentsFor(agents.view, store, agents.activeModuleId, stage);
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
 * The Agents module's parts of the workflow's stage, unit, thread and
 * message views, filled in the slots the workflow leaves for other modules,
 * and the threads whose change request an agent has. Nothing shows in a
 * preview of an earlier state.
 */
export default function AgentsWorkflowSlots({ children }: { children: ReactNode }) {
  const agents = useAgents();
  const slots = useMemo<WorkflowSlots>(
    () => ({
      stage: ({ stage, preview }) => (preview ? null : <StageRequests stage={stage} />),
      unit: ({ unitId, preview }) => (preview ? null : <UnitRequests unitId={unitId} />),
      unitNotes: ({ unitId, preview }) => (preview ? null : <UnitFindings unitId={unitId} />),
      thread: ({ threadId, preview }) => (preview ? null : <ThreadRequests threadId={threadId} />),
      message: ({ threadId, messageId, preview }) => (preview ? null : <MessageNotes threadId={threadId} messageId={messageId} />),
      threadsWithAgent: new Set(agents.view.requests.filter(({ moduleId, holder }) => moduleId === agents.activeModuleId && holder != null).map(({ thread }) => thread.id)),
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
