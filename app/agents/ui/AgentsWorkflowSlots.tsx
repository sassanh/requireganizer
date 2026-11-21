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
import type { AgentId } from "../roster";
import { readOnlyThread } from "../waiting";
import { attempt } from "./attempt";
import { type AgentsPageValue, useAgents } from "./context";
import RunLogDialog from "./RunLogDialog";
import SendButton, { preferredAgent } from "./SendButton";
import { WaitControls } from "./ThreadList";
import { howLongAgo, howLongSince } from "./time";
import WorkingSign from "./WorkingSign";

type Agent = { id: AgentId; name: string };

/** Every available agent. */
function availableAgents(view: DeskView): Agent[] {
  return view.agents.flatMap((agent) => (agent.name == null ? [] : [{ id: agent.id, name: agent.name }]));
}

/**
 * The agents a thread in a stage can be assigned to as a message is sent in
 * it: the one whose thread on a stage itself makes the stage read-only, with
 * why, else every available agent.
 */
function agentsFor(view: DeskView, store: Store, moduleId: string, stage: string): { agents: Agent[]; note: string | null } {
  const readOnly = readOnlyThread(
    view.waiting.filter((waiting) => waiting.holder != null),
    store,
    moduleId,
    stage,
  );
  const available = availableAgents(view);
  if (readOnly == null) return { agents: available, note: null };
  const { agentId, name } = readOnly.holder!;
  return { agents: available.filter(({ id }) => id === agentId), note: `Only ${name} can be assigned threads here while it has “${readOnly.summary}”.` };
}

/** Send a message in a thread, assigning the thread to `to`, or to none, in the same act. */
async function sendTo(agents: AgentsPageValue, send: () => Promise<string | null>, to: AgentId | null): Promise<void> {
  await agents.withAssignment(to, send);
}

/**
 * Under a stage's header: the sign that an agent works there and, from a
 * complete stage, a way to ask for the writing of each stage building on it
 * that may be asked, and to ask for a review of the stage. Each ask opens a
 * thread of its own on the stage it asks for.
 */
const StageAsks = observer(function StageAsks({ stage }: { stage: string }) {
  const agents = useAgents();
  const { client, view, activeModuleId, stageLabel } = agents;
  const store = agents.moduleStore(activeModuleId);
  if (store == null) return null;
  const asks = view.asks.find((entry) => entry.moduleId === activeModuleId && entry.stage === stage);
  const available = availableAgents(view);
  const sendButton = (key: string, label: string, asked: string, onSend: (to: AgentId | null) => void) => {
    const choices = agentsFor(view, store, activeModuleId, asked);
    return <SendButton key={key} label={label} {...choices} preferred={preferredAgent(available, choices.agents, null)} onSend={onSend} />;
  };
  const parts: ReactNode[] = [
    ...(asks?.write ?? []).map((later) =>
      sendButton(later, `Write ${stageLabel(later)}`, later, (to) => attempt(() => client.askToWrite(activeModuleId, later, to), "The stage could not be asked for.")),
    ),
    ...(asks?.review === true
      ? [sendButton("review", "Review", stage, (to) => attempt(() => client.askToReview(activeModuleId, stage, to), "The review could not be asked for."))]
      : []),
  ];
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
      <WorkingSign view={view} place={{ kind: "stage", moduleId: activeModuleId, stage }} onStop={(keys) => attempt(() => client.stopAgents(keys), "The agents could not be stopped.")} />
      {parts}
    </Stack>
  );
});

/** Beside a unit's actions: the sign that an agent works on it. */
const UnitWorking = observer(function UnitWorking({ unitId }: { unitId: string }) {
  const { client, view, activeModuleId } = useAgents();
  return <WorkingSign view={view} place={{ kind: "unit", moduleId: activeModuleId, unitId }} onStop={(keys) => attempt(() => client.stopAgents(keys), "The agent could not be stopped.")} />;
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

/** Under an open thread's state: while it waits for an agent, for how long, which agent has it, and the ways to assign it, stop the agent or withdraw it. */
const ThreadWaiting = observer(function ThreadWaiting({ threadId }: { threadId: string }) {
  const agents = useAgents();
  const waiting = agents.view.waiting.find(({ moduleId, thread }) => moduleId === agents.activeModuleId && thread.id === threadId);
  if (waiting == null) return null;
  return (
    <Stack spacing={0.25}>
      <Typography variant="caption" color="text.secondary">
        Waits for an agent {howLongSince(waiting.since)}
      </Typography>
      <WaitControls waiting={waiting} />
    </Stack>
  );
});

/**
 * Under a thread message: the findings it gives, each item as a marked
 * mention shows it, marked once the item changed since; and, under a
 * message of the spec owner's that set the thread waiting, that it was
 * withdrawn from waiting and when, and a way to open each run log kept with
 * it.
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
              Withdrawn from waiting for an agent {howLongAgo(note.withdrawnAt)}
            </Typography>
          )}
        </Stack>
      ))}
      {runLog != null && <RunLogDialog waitKey={runLog.key} index={runLog.index} onClose={() => setRunLog(null)} />}
    </Stack>
  );
});

/**
 * The agents a thread can be assigned to as a message is sent in it, with
 * why when fewer than are available, and the one the send button itself
 * assigns it to.
 */
function threadChoices(agents: AgentsPageValue, { stage, threadId }: ThreadSendProps): { agents: Agent[]; note: string | null; preferred: AgentId | null } {
  const store = agents.moduleStore(agents.activeModuleId);
  if (store == null) return { agents: [], note: null, preferred: null };
  const choices = agentsFor(agents.view, store, agents.activeModuleId, stage);
  const thread = threadId == null ? undefined : store.threads.find(({ id }) => id === threadId);
  const lastReplier = thread?.messages.findLast(({ author }) => author.kind === "agent")?.author;
  return { ...choices, preferred: preferredAgent(availableAgents(agents.view), choices.agents, lastReplier?.kind === "agent" ? lastReplier.name : null) };
}

/** The thread's send button: it sends the message and assigns the thread to the agent chosen, or to none. */
const ThreadSend = observer(function ThreadSend({ label, disabled, ...props }: ThreadSendProps & { label: string; disabled: boolean }) {
  const agents = useAgents();
  return (
    <SendButton
      label={label}
      {...threadChoices(agents, props)}
      disabled={disabled}
      onSend={(to) => attempt(() => sendTo(agents, props.send, to), "The message could not be sent.")}
    />
  );
});

/**
 * The Agents module's parts of the workflow's stage, unit, thread and
 * message views, filled in the slots the workflow leaves for other modules,
 * and whom each thread waiting for an agent waits for. Nothing shows in a
 * preview of an earlier state.
 */
export default function AgentsWorkflowSlots({ children }: { children: ReactNode }) {
  const agents = useAgents();
  const slots = useMemo<WorkflowSlots>(
    () => ({
      stage: ({ stage, preview }) => (preview ? null : <StageAsks stage={stage} />),
      unit: ({ unitId, preview }) => (preview ? null : <UnitWorking unitId={unitId} />),
      unitNotes: ({ unitId, preview }) => (preview ? null : <UnitFindings unitId={unitId} />),
      thread: ({ threadId, preview }) => (preview ? null : <ThreadWaiting threadId={threadId} />),
      message: ({ threadId, messageId, preview }) => (preview ? null : <MessageNotes threadId={threadId} messageId={messageId} />),
      // A thread waiting for an agent waits for the spec owner while no agent has it, for them to assign it. Thread ids are unique across modules.
      threadWaits: new Map(
        agents.view.waiting.map(({ thread, holder }) => [
          thread.id,
          holder == null ? { forSpecOwner: true, who: "Waits for you to assign it" } : { forSpecOwner: false, who: `${holder.name} has it` },
        ]),
      ),
      send: {
        render: (props) => <ThreadSend {...props} />,
        // The send key does what the send button itself does.
        submit: (props) =>
          sendTo(agents, props.send, threadChoices(agents, props).preferred).catch((error: unknown) =>
            notify(getUserFacingErrorMessage(error, "The message could not be sent."), "error"),
          ),
      },
    }),
    [agents],
  );
  return <workflowSlotsContext.Provider value={slots}>{children}</workflowSlotsContext.Provider>;
}
