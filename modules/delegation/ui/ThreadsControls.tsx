"use client";

import { Forum } from "@mui/icons-material";
import { Badge, Divider, IconButton, MenuItem, Popover, Stack, TextField, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useRef, useState } from "react";

import { ActionTooltip } from "actions/ActionHint";
import { agentLabel } from "agents";
import { useAgents } from "agents/ui";
import { attempt } from "components/notices";
import { isEditableTarget, isOverlayTarget, type ShortcutBinding, useShortcut } from "hooks/shortcuts";

import { availableForEveryThread } from "../availability";
import type { ConfirmationRequest } from "../client";
import { availableCount } from "./choices";
import Confirmation from "./Confirmation";
import { useDelegation } from "./context";
import { threadsShortcut } from "./shortcuts";
import ThreadList, { useThreadGroups } from "./ThreadList";

/** In the agents dialog's tab of its own: the agent of each module, set, changed and cleared by the spec owner, one row per module. */
export const ModuleAgentsTab = observer(function ModuleAgentsTab() {
  const { client, view, modules } = useDelegation();
  const agents = useAgents().view.agents;
  const choosable = agents.filter(availableForEveryThread);
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        The agent offered first when you assign a thread of the module.
      </Typography>
      <Stack divider={<Divider flexItem />}>
        {modules.map((module) => (
          <Stack key={module.id} direction="row" sx={{ alignItems: "center", gap: 2, py: 1 }}>
            <Typography variant="body1" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
              {module.name ?? "The module"}
            </Typography>
            <TextField
              select
              size="small"
              aria-label={`Agent of ${module.name ?? "the module"}`}
              value={view.moduleAgents[module.id] ?? ""}
              onChange={(event) => attempt(() => client.setModuleAgent(module.id, event.target.value === "" ? null : event.target.value), "The agent of the module could not be set.")}
              sx={{ width: 240, flexShrink: 0 }}
              slotProps={{ select: { displayEmpty: true } }}
            >
              <MenuItem value="">No agent</MenuItem>
              {choosable.map((agent) => (
                <MenuItem key={agent.id} value={agent.id}>
                  {agentLabel(agent)}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
});

/**
 * Every thread of every module, dropped down from its top-bar button or
 * opened with its key, in three lists, with how many agents are available
 * for every thread. Its badges count, top right in the attention colour,
 * the threads waiting for the spec owner and, bottom right, the agents
 * available for every thread.
 */
const ThreadsControls = observer(function ThreadsControls() {
  const agents = useAgents().view;
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const forYou = useThreadGroups().get("waiting")!.length;
  const available = availableCount(agents);
  const binding = useMemo<ShortcutBinding>(
    () => ({ id: "open-threads", ...threadsShortcut, when: (event) => !isEditableTarget(event.target) && !isOverlayTarget(event.target), action: () => setOpen(true) }),
    [],
  );
  useShortcut(binding);
  return (
    <>
      <ActionTooltip name="Threads" shortcut={threadsShortcut}>
        <IconButton
          ref={anchor}
          aria-label={`Threads: ${forYou} ${forYou === 1 ? "waits" : "wait"} for you, ${available} ${available === 1 ? "agent" : "agents"} available`}
          onClick={() => setOpen(true)}
        >
          <Badge color="default" showZero badgeContent={available} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
            <Badge color="warning" badgeContent={forYou}>
              <Forum />
            </Badge>
          </Badge>
        </IconButton>
      </ActionTooltip>
      {/* A fixed size, so switching lists never resizes it. */}
      {/* Hung from the window's right edge, just below the top bar, so it sits aside rather than over the middle of the page. */}
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorReference="anchorPosition"
        anchorPosition={{ top: anchor.current?.getBoundingClientRect().bottom ?? 64, left: typeof window === "undefined" ? 0 : window.innerWidth - 8 }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { width: "min(760px, calc(100vw - 32px))", height: "min(70vh, 640px)", display: "flex", flexDirection: "column", p: 2 } } }}
      >
        <Stack spacing={1.5} sx={{ flexGrow: 1, minHeight: 0 }}>
          <Typography variant="caption" color="text.secondary">
            {available} {available === 1 ? "agent" : "agents"} available
          </Typography>
          <ThreadList onGo={() => setOpen(false)} />
        </Stack>
      </Popover>
    </>
  );
});

export default ThreadsControls;

/**
 * Asks the spec owner, before an action of theirs that concerns threads
 * agents have or may be a mistake, whether to give it up or carry it out.
 * The list follows the threads live: one no agent has any more drops out.
 */
export function ConfirmationHost() {
  const { client, view } = useDelegation();
  const [asked, setAsked] = useState<{ request: ConfirmationRequest; answer: (keys: string[] | null) => void } | null>(null);
  useEffect(() => {
    client.setConfirmer((request) => new Promise<string[] | null>((answer) => setAsked({ request, answer })));
    return () => client.setConfirmer(null);
  }, [client]);
  if (asked == null) return null;
  const keys = asked.request.threads.map(({ key }) => key);
  const finish = (confirmed: string[] | null) => {
    setAsked(null);
    asked.answer(confirmed);
  };
  return (
    <Confirmation
      action={asked.request.action}
      threads={view.waiting.filter(({ key }) => keys.includes(key))}
      notes={asked.request.notes}
      onGiveUp={() => finish(null)}
      onCarryOut={finish}
    />
  );
}
