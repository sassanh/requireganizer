"use client";

import { Forum } from "@mui/icons-material";
import { Badge, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useState } from "react";

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

/** The agent of each module, set, changed and cleared by the spec owner. */
function ModuleAgents({ onClose }: { onClose: () => void }) {
  const { client, view, modules } = useDelegation();
  const agents = useAgents().view.agents;
  const choosable = agents.filter(availableForEveryThread);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Agents of modules</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {modules.map((module) => {
            const current = view.moduleAgents[module.id] ?? "";
            return (
              <TextField
                key={module.id}
                select
                size="small"
                label={module.name ?? "The module"}
                value={current}
                onChange={(event) => attempt(() => client.setModuleAgent(module.id, event.target.value === "" ? null : event.target.value), "The agent of the module could not be set.")}
              >
                <MenuItem value="">No agent</MenuItem>
                {choosable.map((agent) => (
                  <MenuItem key={agent.id} value={agent.id}>
                    {agentLabel(agent)}
                  </MenuItem>
                ))}
              </TextField>
            );
          })}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Every thread of every module, opened from the top bar or with its key, in
 * three lists, with how many agents are available for every thread and the
 * agent of each module. Its badges count, top right in the attention
 * colour, the threads waiting for the spec owner and, bottom right, the
 * agents available for every thread.
 */
const ThreadsControls = observer(function ThreadsControls() {
  const agents = useAgents().view;
  const { view, modules } = useDelegation();
  const [open, setOpen] = useState(false);
  const [settingModuleAgents, setSettingModuleAgents] = useState(false);
  const forYou = useThreadGroups().get("waiting")!.length;
  const available = availableCount(agents);
  const binding = useMemo<ShortcutBinding>(
    () => ({ id: "open-threads", ...threadsShortcut, when: (event) => !isEditableTarget(event.target) && !isOverlayTarget(event.target), action: () => setOpen(true) }),
    [],
  );
  useShortcut(binding);
  const moduleAgentNames = modules.flatMap((module) => {
    const agent = agents.agents.find(({ id }) => id === view.moduleAgents[module.id]);
    return agent == null ? [] : [`${module.name ?? "The module"}: ${agentLabel(agent)}`];
  });
  return (
    <>
      <ActionTooltip name="Threads" shortcut={threadsShortcut}>
        <IconButton
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
      {/* A fixed height, so switching lists never resizes it. */}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="md" slotProps={{ paper: { sx: { height: "85vh" } } }}>
        <DialogTitle>Threads</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Stack spacing={2} sx={{ flexGrow: 1, minHeight: 0 }}>
            <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
              <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
                {available} {available === 1 ? "agent is" : "agents are"} available for every thread
                {moduleAgentNames.length === 0 ? "" : ` · ${moduleAgentNames.join(" · ")}`}
              </Typography>
              <Button size="small" onClick={() => setSettingModuleAgents(true)}>
                Agents of modules
              </Button>
            </Stack>
            <ThreadList onGo={() => setOpen(false)} />
          </Stack>
        </DialogContent>
      </Dialog>
      {settingModuleAgents && <ModuleAgents onClose={() => setSettingModuleAgents(false)} />}
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
