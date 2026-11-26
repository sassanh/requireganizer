"use client";

import { Alert, AlertTitle, Button, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { type ReactNode, useMemo, useState } from "react";

import { labelOfId, labelOfName } from "agents";
import { ContextDialog, NameField, useAgents } from "agents/ui";
import { attempt, notify } from "components/notices";
import { howLongAgo } from "lib/elapsed";
import { requestPlace } from "lib/placeRequests";
import type { Store } from "store";
import { authorLabel, parseUnitId, threadPlace, type ThreadMessage, type UnsignedReason } from "workflow";
import { type ThreadSendProps, type WorkflowSlots, workflowSlotsContext } from "workflow/ui";

import { replyAgent } from "../annotations";
import type { NoteView, ProposalView, ReplyPlace } from "../host";
import { threadKey } from "../record";
import { choicesFor } from "./choices";
import { type DelegationPageValue, useDelegation } from "./context";
import ReplyChangesDialog from "./ReplyChangesDialog";
import SendChoice, { openSendChoice } from "./SendChoice";
import { WaitControls } from "./ThreadList";
import WorkingSign from "./WorkingSign";

/** Why a unit of a set was left unsigned, as the spec owner reads it. */
const UNSIGNED_REASONS: Record<UnsignedReason, string> = { changed: "changed since the proposal", "not-signable": "not signable", "not-in-set": "not signed in sets in its stage" };

/** Who gave a note or a proposal, as the spec owner reads it now. */
function useReplyAgent(): (place: ReplyPlace) => string {
  const agents = useAgents().view.agents;
  return (place) => (place.agentId == null ? null : labelOfId(agents, place.agentId)) ?? labelOfName(agents, place.writtenBy);
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

/** Open the reply that gave a note or a proposal, in its thread, with the focus on it. */
function openReply(delegation: DelegationPageValue, place: ReplyPlace): void {
  const thread = delegation.moduleStore(place.moduleId)?.threads.find(({ id }) => id === place.threadId);
  if (thread == null) return;
  const index = thread.messages.findIndex(({ id }) => id === place.messageId);
  requestPlace({ moduleId: place.moduleId, stage: thread.stage, unitId: threadPlace(thread) }, { leavePreview: true, message: { threadId: thread.id, index } });
}

/**
 * Under a unit's content: each finding and choice agents' replies give on
 * it, while the unit is as it was when the note was given, with the agent
 * that gave it, when, whether it is on that agent's own work, and a way to
 * open the reply that gave it.
 */
const UnitNotes = observer(function UnitNotes({ unitId }: { unitId: string }) {
  const delegation = useDelegation();
  const agentOf = useReplyAgent();
  const notes = delegation.view.notes.filter((note) => note.unitId === unitId && !note.changed);
  return (
    <>
      {notes.map((note) => (
        <Alert
          key={`${note.messageId} ${note.note.kind === "finding" ? note.note.rule : "choice"}`}
          severity={note.note.kind === "finding" ? "warning" : "info"}
          variant="outlined"
          sx={{ mt: 1 }}
          action={
            <Button size="small" color="inherit" onClick={() => openReply(delegation, note)}>
              Open the reply
            </Button>
          }
        >
          <AlertTitle>
            {note.note.kind === "finding" ? "Finding by" : "Yours to decide, named by"} {agentOf(note)}
            {note.ownWork ? ", on its own work" : ""}
            {note.at == null ? "" : ` · ${howLongAgo(note.at)}`}
          </AlertTitle>
          <NoteText note={note} />
        </Alert>
      ))}
    </>
  );
});

/** What a note says: a finding's how and rule, or the choice a unit makes. */
function NoteText({ note }: { note: NoteView }) {
  if (note.note.kind === "choice") return <Typography variant="body2">{note.note.choice}</Typography>;
  return (
    <>
      <Typography variant="body2">{note.note.how}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
        Rule: {note.note.rule}
      </Typography>
    </>
  );
}

/** One unit a reply's summary leads to, with what the spec owner is told of it there. */
interface WalkedUnit {
  unitId: string;
  /** It changed since the reply, or can no longer be signed as proposed. */
  changed: boolean;
  ownWork: boolean;
}

/**
 * One line of a reply's summary: how many units its findings, its choices
 * or its proposal name, and a way to go to them one by one, telling for the
 * unit gone to whether it changed since and whether it is on the agent's
 * own work. The details are on each unit, where it is gone to.
 */
const UnitWalk = observer(function UnitWalk({ moduleId, label, color, units, changedLabel, children }: { moduleId: string; label: string; color: string; units: readonly WalkedUnit[]; changedLabel: string; children?: ReactNode }) {
  const { moduleStore } = useDelegation();
  const [index, setIndex] = useState<number | null>(null);
  const store = moduleStore(moduleId);
  const shown = index == null ? null : units[index];
  const go = (next: number) => {
    const unit = units[next];
    const stage = unit == null ? undefined : store?.unitState(unit.unitId)?.stage;
    if (unit == null || stage == null) return;
    setIndex(next);
    requestPlace({ moduleId, stage, unitId: unit.unitId }, { leavePreview: true });
  };
  return (
    <Stack spacing={0.25} sx={{ pl: 1, borderLeft: 2, borderColor: color, alignItems: "flex-start" }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Typography variant="body2">{label}</Typography>
        {units.length > 0 && (
          <Button size="small" onClick={() => go(index == null ? 0 : (index + 1) % units.length)}>
            {index == null ? "Go through them" : "Next"}
          </Button>
        )}
        {children}
      </Stack>
      {shown != null && (
        <Typography variant="caption" color="text.secondary">
          {store?.unitLabel(shown.unitId) ?? "A removed unit"} ({index! + 1} of {units.length})
          {shown.changed ? ` · ${changedLabel}` : ""}
          {shown.ownWork ? " · on its own work" : ""}
        </Typography>
      )}
    </Stack>
  );
});

/** "1 finding", "35 findings". */
const counted = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Under a reply: how many units its findings, its choices and its proposal
 * name, each with a way to go to them one by one; and while the proposal's
 * offer stands, a way to sign in one act the units still as proposed.
 */
const ReplySummary = observer(function ReplySummary({ moduleId, notes, proposal }: { moduleId: string; notes: readonly NoteView[]; proposal: ProposalView | undefined }) {
  const { moduleStore } = useDelegation();
  const agentOf = useReplyAgent();
  const findings = notes.filter((note) => note.note.kind === "finding");
  const choices = notes.filter((note) => note.note.kind === "choice");
  const walked = (each: readonly NoteView[]) => each.map(({ unitId, changed, ownWork }) => ({ unitId, changed, ownWork }));
  const store = moduleStore(moduleId);
  const signSet = (shown: ProposalView) =>
    attempt(async () => {
      if (store == null) return;
      const outcome = await store.signSet({
        basis: { proposal: shown.messageId, agent: agentOf(shown) },
        units: shown.units.map(({ unitId, covers }) => ({ unitId, covers })),
      });
      const unsigned = outcome.unsigned.map(({ unitId, reason }) => `${store.unitLabel(unitId)} (${UNSIGNED_REASONS[reason]})`);
      notify(`Signed ${outcome.signed.length} of ${shown.units.length}.${unsigned.length === 0 ? "" : ` Left unsigned: ${unsigned.join(", ")}.`}`);
    }, "The set could not be signed.");
  return (
    <>
      {findings.length > 0 && <UnitWalk moduleId={moduleId} label={counted(findings.length, "finding", "findings")} color="warning.main" units={walked(findings)} changedLabel="changed since" />}
      {choices.length > 0 && <UnitWalk moduleId={moduleId} label={`${counted(choices.length, "choice", "choices")} yours to decide`} color="info.main" units={walked(choices)} changedLabel="changed since" />}
      {proposal != null && (
        <UnitWalk
          moduleId={moduleId}
          label={`${counted(proposal.units.length, "unit", "units")} proposed for signing in one act`}
          color="success.main"
          units={proposal.units.map(({ unitId, signable, ownWork }) => ({ unitId, changed: !signable, ownWork }))}
          changedLabel="no longer signable as proposed"
        >
          {proposal.offered && (
            <Button size="small" variant="contained" onClick={() => signSet(proposal)}>
              Sign these {proposal.units.filter((unit) => unit.signable).length}
            </Button>
          )}
        </UnitWalk>
      )}
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
 * Under a thread message: how many units its findings, choices and
 * proposal name, each with a way to go to them; under an agent's reply sent with changes, a way to
 * see the item changes it made; and under a message of the spec owner's
 * that set the thread waiting, that it was withdrawn from waiting and when.
 */
const MessageNotes = observer(function MessageNotes({ threadId, messageId }: { threadId: string; messageId: string }) {
  const { view, activeModuleId, moduleStore } = useDelegation();
  const [showingChanges, setShowingChanges] = useState(false);
  const store = moduleStore(activeModuleId);
  const message = store?.threads.find(({ id }) => id === threadId)?.messages.find(({ id }) => id === messageId);
  const notes = view.notes.filter((note) => note.moduleId === activeModuleId && note.messageId === messageId);
  const proposal = view.proposals.find((each) => each.moduleId === activeModuleId && each.messageId === messageId);
  const withdrawn = view.withdrawn.find((note) => note.moduleId === activeModuleId && note.threadId === threadId && note.messageId === messageId);
  const changes = message?.author.kind === "agent" && message.withChanges === true;
  if (notes.length === 0 && proposal == null && withdrawn == null && !changes) return null;
  return (
    <Stack spacing={0.75} sx={{ mt: 0.5, alignItems: "flex-start" }}>
      <ReplySummary moduleId={activeModuleId} notes={notes} proposal={proposal} />
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
      unitNotes: ({ unitId, preview }) => (preview ? null : <UnitNotes unitId={unitId} />),
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
