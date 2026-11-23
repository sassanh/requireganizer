"use client";

import { Alert, AlertTitle, Button, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { type ReactNode, useMemo, useState } from "react";

import { labelOfId, labelOfName } from "agents";
import { ContextDialog, NameField, useAgents } from "agents/ui";
import { attempt } from "components/notices";
import { howLongAgo } from "lib/elapsed";
import { requestPlace } from "lib/placeRequests";
import type { Store } from "store";
import { authorLabel, parseUnitId, revisionOf, threadPlace, type ThreadMessage } from "workflow";
import { ItemChip, type ThreadSendProps, type WorkflowSlots, workflowSlotsContext } from "workflow/ui";

import { replyAgent } from "../annotations";
import type { FindingView } from "../host";
import { threadKey } from "../record";
import { choicesFor } from "./choices";
import { type DelegationPageValue, useDelegation } from "./context";
import ReplyChangesDialog from "./ReplyChangesDialog";
import SendChoice, { openSendChoice } from "./SendChoice";
import { WaitControls } from "./ThreadList";
import WorkingSign from "./WorkingSign";

/** Whether the item a finding names changed since the finding was given; false once the item is gone. */
function changedSince(store: Store, finding: FindingView): boolean {
  const version = store.findLinked(finding.itemId)?.version;
  return version != null && revisionOf(version) !== finding.revision;
}

/** Who gave a finding, as the spec owner reads it now. */
function useFindingAgent(): (finding: FindingView) => string {
  const agents = useAgents().view.agents;
  return (finding) => (finding.agentId == null ? null : labelOfId(agents, finding.agentId)) ?? labelOfName(agents, finding.writtenBy);
}

/**
 * Under a stage's header: the agent work sign and the ways to ask for the
 * stage to be updated or reviewed and, from a complete stage, for every
 * stage building on it that may be asked to be updated, in one step. Each
 * ask opens a thread of its own on the stage it asks for.
 */
const StageAsks = observer(function StageAsks({ stage }: { stage: string }) {
  const { client, view, activeModuleId, moduleStore, stageLabel } = useDelegation();
  const agents = useAgents().view;
  const store = moduleStore(activeModuleId);
  if (store == null) return null;
  const asks = view.asks.find((entry) => entry.moduleId === activeModuleId && entry.stage === stage);
  const choices = (asked: string) => choicesFor(agents, view, store, { moduleId: activeModuleId, stage: asked, threadId: null });
  const parts: ReactNode[] = [
    ...(asks?.update === true
      ? [<SendChoice key="update" label="Ask to update" variant="outlined" choices={choices(stage)} onSend={(to) => attempt(() => client.askToUpdate(activeModuleId, [stage], to), "The update could not be asked for.")} />]
      : []),
    ...(asks?.review === true
      ? [<SendChoice key="review" label="Ask to review" variant="outlined" choices={choices(stage)} onSend={(to) => attempt(() => client.askToReview(activeModuleId, stage, to), "The review could not be asked for.")} />]
      : []),
    ...(asks != null && asks.updateAfter.length > 0
      ? [
          <SendChoice
            key="update after"
            label={`Ask to update ${asks.updateAfter.map(stageLabel).join(", ")}`}
            variant="outlined"
            choices={choices(asks.updateAfter[0]!)}
            onSend={(to) => attempt(() => client.askToUpdate(activeModuleId, asks.updateAfter, to), "The updates could not be asked for.")}
          />,
        ]
      : []),
  ];
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
      <WorkingSign place={{ kind: "stage", moduleId: activeModuleId, stage }} />
      {parts}
    </Stack>
  );
});

/** Beside a unit's actions: the agent work sign. */
function UnitWorking({ unitId }: { unitId: string }) {
  const { activeModuleId } = useDelegation();
  return <WorkingSign place={{ kind: "unit", moduleId: activeModuleId, unitId }} />;
}

/** Open the reply that gave a finding, in its thread, with the focus on it. */
function openReply(delegation: DelegationPageValue, finding: FindingView): void {
  const thread = delegation.moduleStore(finding.moduleId)?.threads.find(({ id }) => id === finding.threadId);
  if (thread == null) return;
  const index = thread.messages.findIndex(({ id }) => id === finding.messageId);
  requestPlace({ moduleId: finding.moduleId, stage: thread.stage, unitId: threadPlace(thread) }, { leavePreview: true, message: { threadId: thread.id, index } });
}

/**
 * Under an item's content: each finding agents' replies give on it, while
 * the item is as it was when the finding was given, with the agent that
 * gave it, when, whether it is on that agent's own work, and a way to open
 * the reply that gave it.
 */
const UnitFindings = observer(function UnitFindings({ unitId }: { unitId: string }) {
  const delegation = useDelegation();
  const agentOf = useFindingAgent();
  const store = delegation.moduleStore(delegation.activeModuleId);
  const address = parseUnitId(unitId);
  const findings = store == null || address.kind !== "item" ? [] : delegation.view.findings.filter((finding) => finding.itemId === address.itemId && !changedSince(store, finding));
  return (
    <>
      {findings.map((finding) => (
        <Alert
          key={`${finding.messageId} ${finding.rule}`}
          severity="warning"
          variant="outlined"
          sx={{ mt: 1 }}
          action={
            <Button size="small" color="inherit" onClick={() => openReply(delegation, finding)}>
              Open the reply
            </Button>
          }
        >
          <AlertTitle>
            Finding by {agentOf(finding)}
            {finding.ownWork ? ", on its own work" : ""}
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

/**
 * Under an open thread's state: while it waits for an agent, since when,
 * which agent has it and since when, or that no agent has it, with the ways
 * to act on it; a way to see the context of each internal agent that had
 * it; and a way to name the internal agent started in it while it has no
 * name.
 */
const ThreadWaiting = observer(function ThreadWaiting({ threadId }: { threadId: string }) {
  const { view, activeModuleId } = useDelegation();
  const agents = useAgents().view.agents;
  const [context, setContext] = useState<string | null>(null);
  const waiting = view.waiting.find(({ moduleId, thread }) => moduleId === activeModuleId && thread.id === threadId);
  const key = threadKey({ moduleId: activeModuleId, threadId });
  const internal = [...new Set(view.threadAgents[key] ?? [])].flatMap((agentId) => agents.filter((agent) => agent.id === agentId && agent.kind === "internal"));
  const unnamed = agents.find((agent) => agent.kind === "internal" && agent.name == null && !agent.archived && view.startedIn[agent.id]?.moduleId === activeModuleId && view.startedIn[agent.id]?.threadId === threadId);
  if (waiting == null && internal.length === 0) return null;
  return (
    <Stack spacing={0.5}>
      {waiting != null && <WaitControls waiting={waiting} />}
      {internal.length > 0 && (
        <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap" }}>
          {internal.map((agent) => (
            <Button key={agent.id} size="small" onClick={() => setContext(agent.id)}>
              Context of {labelOfId(agents, agent.id)}
            </Button>
          ))}
        </Stack>
      )}
      {unnamed != null && <NameField agent={unnamed} />}
      {context != null && <ContextDialog agentId={context} topic={key} onClose={() => setContext(null)} />}
    </Stack>
  );
});

/**
 * Under a thread message: the findings it gives, each item as a marked
 * mention shows it, marked once the item changed since and when it is on
 * its giver's own work; under an agent's reply sent with changes, a way to
 * see the item changes it made; and under a message of the spec owner's
 * that set the thread waiting, that it was withdrawn from waiting and when.
 */
const MessageNotes = observer(function MessageNotes({ threadId, messageId }: { threadId: string; messageId: string }) {
  const { view, activeModuleId, moduleStore } = useDelegation();
  const [showingChanges, setShowingChanges] = useState(false);
  const store = moduleStore(activeModuleId);
  const message = store?.threads.find(({ id }) => id === threadId)?.messages.find(({ id }) => id === messageId);
  const findings = view.findings.filter((finding) => finding.moduleId === activeModuleId && finding.messageId === messageId);
  const withdrawn = view.withdrawn.find((note) => note.moduleId === activeModuleId && note.threadId === threadId && note.messageId === messageId);
  const changes = message?.author.kind === "agent" && message.withChanges === true;
  if (findings.length === 0 && withdrawn == null && !changes) return null;
  return (
    <Stack spacing={0.75} sx={{ mt: 0.5, alignItems: "flex-start" }}>
      {findings.map((finding) => (
        <Stack key={`${finding.itemId} ${finding.rule}`} spacing={0.25} sx={{ pl: 1, borderLeft: 2, borderColor: "warning.main" }}>
          <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <ItemChip itemId={finding.itemId} />
            {store != null && changedSince(store, finding) && (
              <Typography variant="caption" color="text.secondary">
                changed since this finding
              </Typography>
            )}
            {finding.ownWork && (
              <Typography variant="caption" color="warning.main">
                on its own work
              </Typography>
            )}
          </Stack>
          <Typography variant="body2">{finding.how}</Typography>
          <Typography variant="caption" color="text.secondary">
            Rule: {finding.rule}
          </Typography>
        </Stack>
      ))}
      {changes && (
        <Button size="small" onClick={() => setShowingChanges(true)}>
          Item changes
        </Button>
      )}
      {withdrawn != null && (
        <Typography variant="caption" color="text.secondary">
          Withdrawn from waiting for an agent {howLongAgo(withdrawn.at)}
        </Typography>
      )}
      {showingChanges && <ReplyChangesDialog messageId={messageId} onClose={() => setShowingChanges(false)} />}
    </Stack>
  );
});

/** Where a thread's send button sends, as its key names it. */
const sendPlace = ({ stage, unitId, threadId }: Pick<ThreadSendProps, "stage" | "unitId" | "threadId">) => `${stage} ${unitId ?? ""} ${threadId ?? ""}`;

/** The thread's send button: it sends the message and assigns the thread to the agent chosen, or to none. */
const ThreadSend = observer(function ThreadSend({ label, disabled, ...props }: ThreadSendProps & { label: string; disabled: boolean }) {
  const delegation = useDelegation();
  const agents = useAgents().view;
  const store = delegation.moduleStore(delegation.activeModuleId);
  if (store == null) return null;
  return (
    <SendChoice
      label={label}
      place={sendPlace(props)}
      disabled={disabled}
      choices={choicesFor(agents, delegation.view, store, { moduleId: delegation.activeModuleId, stage: props.stage, threadId: props.threadId })}
      onSend={(to) => attempt(() => delegation.withAssignment(to, props.send), "The message could not be sent.")}
    />
  );
});

/**
 * Delegation's parts of the workflow's stage, unit, thread and message
 * views, filled in the slots the workflow leaves for other modules; whom
 * each open thread waits for; and who wrote each message, as the spec owner
 * reads each agent now. Nothing shows in a preview of an earlier state.
 */
export default function DelegationWorkflowSlots({ children }: { children: ReactNode }) {
  const delegation = useDelegation();
  const agents = useAgents().view.agents;
  const slots = useMemo<WorkflowSlots>(() => {
    const labelOf = (agentId: string) => labelOfId(agents, agentId) ?? "An agent";
    // Whom each open thread waits for: the agent that has it; else the spec owner, whatever its last message.
    const threadWaits = new Map<string, { forSpecOwner: boolean; who: string }>();
    for (const { id } of delegation.modules) {
      for (const thread of delegation.moduleStore(id)?.threads ?? []) {
        if (thread.resolution == null && thread.messages.at(-1)?.author.kind === "person") threadWaits.set(thread.id, { forSpecOwner: true, who: "Waits for you" });
      }
    }
    for (const { thread, holder } of delegation.view.waiting) {
      threadWaits.set(thread.id, holder == null ? { forSpecOwner: true, who: "Waits for you to assign it" } : { forSpecOwner: false, who: `${labelOf(holder.agentId)} has it` });
    }
    return {
      stage: ({ stage, preview }) => (preview ? null : <StageAsks stage={stage} />),
      unit: ({ unitId, preview }) => (preview ? null : <UnitWorking unitId={unitId} />),
      unitNotes: ({ unitId, preview }) => (preview ? null : <UnitFindings unitId={unitId} />),
      thread: ({ threadId, preview }) => (preview ? null : <ThreadWaiting threadId={threadId} />),
      message: ({ threadId, messageId, preview }) => (preview ? null : <MessageNotes threadId={threadId} messageId={messageId} />),
      threadWaits,
      messageAuthor: (message: ThreadMessage) => {
        if (message.author.kind !== "agent") return authorLabel(message.author);
        const agentId = replyAgent(message);
        return (agentId == null ? null : labelOfId(agents, agentId)) ?? labelOfName(agents, message.author.name);
      },
      send: {
        render: (props) => <ThreadSend {...props} />,
        // The send key opens the choice of whom to send to, as the button does: the system never picks an agent.
        submit: async (props) => {
          openSendChoice(sendPlace(props));
        },
      },
    };
  }, [delegation, agents]);
  return <workflowSlotsContext.Provider value={slots}>{children}</workflowSlotsContext.Provider>;
}
