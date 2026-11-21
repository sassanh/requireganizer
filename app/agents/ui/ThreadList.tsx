"use client";

import { Box, Button, Menu, MenuItem, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import InModule from "components/InModule";
import type { Store } from "store";
import { inListOrder, type Thread, threadPlace } from "workflow";
import {
  CountedLabel,
  ItemPreviewProvider,
  THREAD_GRID,
  ThreadCard,
  ThreadRow,
  useWaitsForSpecOwner,
} from "workflow/ui";

import type { WaitingThreadState } from "../desk";
import { attempt } from "./attempt";
import { useAgents } from "./context";
import { howLongSince } from "./time";

/**
 * The ways to assign a thread waiting for an agent, stop the agent working
 * on it, or withdraw it, with why the agent it was last assigned to
 * failed. The one set of these actions, in the list of every thread and in
 * the thread itself.
 */
function WaitActions({ waiting }: { waiting: WaitingThreadState }) {
  const { client, view, stageLabel } = useAgents();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const agents = view.agents.flatMap((agent) => (agent.name != null && waiting.assignableTo.includes(agent.id) ? [{ id: agent.id, name: agent.name }] : []));
  const free = waiting.holder == null;
  return (
    <Stack direction="row" sx={{ alignItems: "center", columnGap: 1, flexWrap: "wrap" }}>
      {free && !waiting.stageOpen && (
        <Typography variant="caption" color="text.secondary">
          Can be assigned once {stageLabel(waiting.stage)} opens
        </Typography>
      )}
      {free && agents.length > 0 && (
        <>
          <Button size="small" aria-haspopup="menu" aria-expanded={anchor != null} onClick={(event) => setAnchor(event.currentTarget)}>
            Assign to…
          </Button>
          <Menu anchorEl={anchor} open={anchor != null} onClose={() => setAnchor(null)}>
            {agents.map((agent) => (
              <MenuItem
                key={agent.id}
                onClick={() => {
                  setAnchor(null);
                  attempt(() => client.assignThread(waiting.key, agent.id), "The thread could not be assigned.");
                }}
              >
                {agent.name}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
      {free ? (
        <Button size="small" color="error" onClick={() => attempt(() => client.withdrawThread(waiting.key), "The thread could not be withdrawn.")}>
          Withdraw
        </Button>
      ) : (
        <Button size="small" onClick={() => attempt(() => client.stopAgents([waiting.key]), "The agent could not be stopped.")}>
          Stop
        </Button>
      )}
      {waiting.failure != null && (
        <Typography variant="caption" color="error" sx={{ flexBasis: "100%" }}>
          {waiting.failure}
        </Typography>
      )}
    </Stack>
  );
}

/** Which agent has a thread waiting for an agent and for how long, or that none does, then the ways to act on it. */
export function WaitControls({ waiting }: { waiting: WaitingThreadState }) {
  return (
    <Stack direction="row" sx={{ alignItems: "center", columnGap: 1, flexWrap: "wrap" }}>
      <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1, minWidth: 0 }}>
        {waiting.holder == null ? "No agent has it" : `${waiting.holder.name} has it ${howLongSince(waiting.holder.since)}`}
      </Typography>
      <WaitActions waiting={waiting} />
    </Stack>
  );
}

/** A thread of a module, as the list of every thread shows it, with its module and where it is. */
export interface ListedThread {
  key: string;
  thread: Thread;
  /** Where the thread is, as `threadPlace` names it. */
  place: string;
  moduleId: string;
  moduleName: string | null;
  store: Store;
}

/** Every thread of every module of the open project; a place holds at most one open thread. */
export function useEveryThread(): ListedThread[] {
  const { modules, moduleStore } = useAgents();
  return modules.flatMap(({ id, name }) => {
    const store = moduleStore(id);
    if (store == null) return [];
    return store.threads.map((thread) => ({ key: `${id} ${thread.id}`, thread, place: threadPlace(thread), moduleId: id, moduleName: name, store }));
  });
}

/** The groups of the list of every thread, one shown at a time, each with what it says while it holds none. */
const GROUPS = [
  { group: "waiting", label: "Waiting for you", empty: "No thread waits for you." },
  { group: "agent", label: "With an agent", empty: "No agent has a thread." },
  { group: "resolved", label: "Resolved", empty: "No resolved threads." },
] as const;
type Group = (typeof GROUPS)[number]["group"];

/**
 * One thread of the list, as its stage shows it, what it is on being the
 * way there; with its module and stage unless that is what it is on; and,
 * while it waits for an agent, since when, and since when the agent that
 * has it has had it, with the ways to assign it, stop the agent or
 * withdraw it.
 */
const Listed = observer(function Listed({ listed, onGo }: { listed: ListedThread; onGo: () => void }) {
  const { view, stageLabel } = useAgents();
  const { thread, place, moduleId, moduleName, store } = listed;
  const waiting = view.waiting.find((each) => each.moduleId === moduleId && each.thread.id === thread.id) ?? null;
  const where = [
    ...(thread.unitId == null ? [] : [moduleName, stageLabel(thread.stage)]),
    ...(waiting == null ? [] : [`waits for an agent ${howLongSince(waiting.since)}`]),
  ]
    .filter((part) => part != null)
    .join(" · ");
  const context =
    where === "" ? null : (
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
          who={waiting?.holder == null ? undefined : `${waiting.holder.name} has had it ${howLongSince(waiting.holder.since)}`}
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
 * Every thread of every module, in three groups, one shown at a time,
 * switched with a button per group that counts its threads: those waiting
 * for the spec owner, those an agent has, and the resolved, each in the
 * order threads are listed. It opens on those waiting for the spec owner.
 */
const ThreadList = observer(function ThreadList({ onGo }: { /** The list is left, to show a thread where it is. */ onGo: () => void }) {
  const waitsForSpecOwner = useWaitsForSpecOwner();
  const [group, setGroup] = useState<Group>("waiting");
  const grouped = new Map<Group, ListedThread[]>(GROUPS.map(({ group: each }) => [each, []]));
  for (const listed of inListOrder(useEveryThread(), ({ thread }) => thread)) {
    grouped.get(listed.thread.resolution != null ? "resolved" : waitsForSpecOwner(listed.thread) ? "waiting" : "agent")!.push(listed);
  }
  const shown = grouped.get(group)!;
  return (
    <ItemPreviewProvider>
      {/* The switch stays put; only the list under it scrolls. */}
      <Stack spacing={1.5} sx={{ flexGrow: 1, minHeight: 0 }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={group}
          aria-label="Every thread"
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
