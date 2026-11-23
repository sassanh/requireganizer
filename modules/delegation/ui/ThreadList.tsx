"use client";

import { Box, Button, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import { labelOfId } from "agents";
import { useAgents } from "agents/ui";
import InModule from "components/InModule";
import { attempt } from "components/notices";
import { howLongSince } from "lib/elapsed";
import type { Store } from "store";
import { inListOrder, type Thread, threadPlace } from "workflow";
import { CountedLabel, ItemPreviewProvider, THREAD_GRID, ThreadCard, ThreadRow, useWaitsForSpecOwner } from "workflow/ui";

import type { WaitingView } from "../host";
import { threadKey } from "../record";
import { choicesFor } from "./choices";
import { useDelegation } from "./context";
import SendChoice from "./SendChoice";

/**
 * The ways to act on a thread waiting for an agent: assign it, while no
 * agent has it, or withdraw it; stop the agent that has it, or ask it to
 * continue; with why the agent it was last assigned to failed, until it is
 * assigned again. The one set of these actions, in the lists of threads and
 * in the thread itself.
 */
function WaitActions({ waiting }: { waiting: WaitingView }) {
  const { client, view, moduleStore } = useDelegation();
  const agents = useAgents().view;
  const store = moduleStore(waiting.moduleId);
  const failure = view.failures[threadKey({ moduleId: waiting.moduleId, threadId: waiting.thread.id })];
  const free = waiting.holder == null;
  return (
    <Stack direction="row" sx={{ alignItems: "center", columnGap: 1, flexWrap: "wrap" }}>
      {free && store != null && (
        <SendChoice
          label="Assign"
          variant="text"
          choices={choicesFor(agents, view, store, { moduleId: waiting.moduleId, stage: waiting.stage, threadId: waiting.thread.id })}
          onSend={(to) => {
            if (to != null) attempt(() => client.assignThread(waiting.key, to), "The thread could not be assigned.");
          }}
        />
      )}
      {free ? (
        <Button size="small" color="error" onClick={() => attempt(() => client.withdrawThread(waiting.key), "The thread could not be withdrawn.")}>
          Withdraw
        </Button>
      ) : (
        <>
          <Button
            size="small"
            disabled={waiting.continueProblem != null}
            title={waiting.continueProblem ?? undefined}
            onClick={() => attempt(() => client.continueThread(waiting.key), "The agent could not be asked to continue.")}
          >
            Continue
          </Button>
          <Button size="small" onClick={() => attempt(() => client.stopAgents([waiting.key]), "The agent could not be stopped.")}>
            Stop
          </Button>
        </>
      )}
      {free && failure != null && (
        <Typography variant="caption" color="error" sx={{ flexBasis: "100%" }}>
          {labelOfId(agents.agents, failure.agentId) ?? "The agent"} failed to answer it: {failure.why}
        </Typography>
      )}
    </Stack>
  );
}

/** Since when a thread waits for an agent, which agent has it and since when, or that no agent has it. */
export function waitText(waiting: WaitingView, agentLabelOf: (agentId: string) => string): string {
  const holder = waiting.holder == null ? "no agent has it" : `${agentLabelOf(waiting.holder.agentId)} has had it ${howLongSince(waiting.holder.since)}`;
  return `Waits for an agent ${howLongSince(waiting.since)}; ${holder}`;
}

/** That a thread waits for an agent, since when and who has it, then the ways to act on it. */
export function WaitControls({ waiting }: { waiting: WaitingView }) {
  const agents = useAgents().view.agents;
  return (
    <Stack direction="row" sx={{ alignItems: "center", columnGap: 1, flexWrap: "wrap" }}>
      <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1, minWidth: 0 }}>
        {waitText(waiting, (agentId) => labelOfId(agents, agentId) ?? "An agent")}
      </Typography>
      <WaitActions waiting={waiting} />
    </Stack>
  );
}

/** A thread of a module, as the lists of threads show it, with its module and where it is. */
interface ListedThread {
  key: string;
  thread: Thread;
  /** Where the thread is, as `threadPlace` names it. */
  place: string;
  moduleId: string;
  moduleName: string | null;
  store: Store;
}

/** Every thread of every module of the open project. */
function useEveryThread(): ListedThread[] {
  const { modules, moduleStore } = useDelegation();
  return modules.flatMap(({ id, name }) => {
    const store = moduleStore(id);
    if (store == null) return [];
    return store.threads.map((thread) => ({ key: `${id} ${thread.id}`, thread, place: threadPlace(thread), moduleId: id, moduleName: name, store }));
  });
}

/** The lists of threads, one shown at a time, each with what it says while it holds none. */
const GROUPS = [
  { group: "waiting", label: "Waiting for you", empty: "No thread waits for you." },
  { group: "agent", label: "With an agent", empty: "No agent has a thread." },
  { group: "resolved", label: "Resolved", empty: "No resolved threads." },
] as const;
type Group = (typeof GROUPS)[number]["group"];

/** The threads of every module in their lists: those waiting for the spec owner, those an agent has, and the resolved, each in the order threads are listed. */
export function useThreadGroups(): Map<Group, ListedThread[]> {
  const waitsForSpecOwner = useWaitsForSpecOwner();
  const grouped = new Map<Group, ListedThread[]>(GROUPS.map(({ group }) => [group, []]));
  for (const listed of inListOrder(useEveryThread(), ({ thread }) => thread)) {
    grouped.get(listed.thread.resolution != null ? "resolved" : waitsForSpecOwner(listed.thread) ? "waiting" : "agent")!.push(listed);
  }
  return grouped;
}

/**
 * One thread of the lists: what it is on, the way there; its module and
 * stage, and its unit when it is on one; and, while it waits for an agent,
 * since when, which agent has it and since when, or that no agent has it,
 * with the ways to act on it.
 */
const Listed = observer(function Listed({ listed, onGo }: { listed: ListedThread; onGo: () => void }) {
  const { view, stageLabel } = useDelegation();
  const agents = useAgents().view.agents;
  const { thread, place, moduleId, moduleName, store } = listed;
  const waiting = view.waiting.find((each) => each.moduleId === moduleId && each.thread.id === thread.id) ?? null;
  const labelOf = (agentId: string) => labelOfId(agents, agentId) ?? "An agent";
  const where = [moduleName, stageLabel(thread.stage), ...(waiting == null ? [] : [waitText(waiting, labelOf)])].filter((part) => part != null).join(" · ");
  const context = (
    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
      {where}
    </Typography>
  );
  return (
    <InModule store={store} moduleId={moduleId} onLeave={onGo}>
      {thread.resolution == null ? (
        <ThreadRow
          stage={thread.stage}
          place={place}
          moduleName={moduleName}
          who={waiting?.holder == null ? undefined : `${labelOf(waiting.holder.agentId)} has it`}
          context={context}
          actions={waiting == null ? null : <WaitActions waiting={waiting} />}
        />
      ) : (
        <ThreadCard thread={thread} moduleName={moduleName} footer={context} />
      )}
    </InModule>
  );
});

/**
 * All threads of every module in three lists, one shown at a time, switched
 * with a button per list that counts its threads: those waiting for the
 * spec owner, those an agent has, and the resolved. It opens on those
 * waiting for the spec owner.
 */
const ThreadList = observer(function ThreadList({ onGo }: { /** The list is left, to show a thread where it is. */ onGo: () => void }) {
  const [group, setGroup] = useState<Group>("waiting");
  const grouped = useThreadGroups();
  const shown = grouped.get(group)!;
  return (
    <ItemPreviewProvider>
      {/* The switch stays put; only the list under it scrolls. */}
      <Stack spacing={1.5} sx={{ flexGrow: 1, minHeight: 0 }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={group}
          aria-label="Threads"
          onChange={(_event, chosen: Group | null) => {
            if (chosen != null) setGroup(chosen);
          }}
          sx={{ alignSelf: "flex-start", flexShrink: 0 }}
        >
          {GROUPS.map(({ group: each, label }) => {
            const count = grouped.get(each)!.length;
            return (
              <ToggleButton key={each} value={each} sx={{ textTransform: "none", px: 1.5, py: 0.25 }}>
                <CountedLabel label={label} count={count} attention={each === "waiting" && count > 0 ? "waits for you" : null} />
              </ToggleButton>
            );
          })}
        </ToggleButtonGroup>
        <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: "auto" }}>
          {shown.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {GROUPS.find(({ group: each }) => each === group)!.empty}
            </Typography>
          ) : group === "resolved" ? (
            <Box sx={THREAD_GRID}>
              {shown.map((listed) => (
                <Listed key={listed.key} listed={listed} onGo={onGo} />
              ))}
            </Box>
          ) : (
            <Stack spacing={0.75}>
              {shown.map((listed) => (
                <Listed key={listed.key} listed={listed} onGo={onGo} />
              ))}
            </Stack>
          )}
        </Box>
      </Stack>
    </ItemPreviewProvider>
  );
});

export default ThreadList;
