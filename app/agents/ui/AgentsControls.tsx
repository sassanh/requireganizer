"use client";

import { SmartToy } from "@mui/icons-material";
import { Badge, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useState } from "react";

import { ActionTooltip } from "actions/ActionHint";
import { isEditableTarget, isOverlayTarget, type ShortcutBinding, useShortcut } from "hooks/shortcuts";
import { useWaitsForSpecOwner } from "workflow/ui";

import type { WaitingThreadState } from "../desk";
import AgentList from "./AgentList";
import { attempt } from "./attempt";
import { useAgents } from "./context";
import { agentsShortcut } from "./shortcuts";
import StopConfirmation from "./StopConfirmation";
import ThreadList, { useEveryThread } from "./ThreadList";
import WorkingSign from "./WorkingSign";

/** The agents in one row, each by its name and each unnamed coding agent as such, with the way to manage them. */
function AgentsRow({ onManage }: { onManage: () => void }) {
  const { view } = useAgents();
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
      <Typography variant="subtitle2" sx={{ mr: 0.5 }}>
        Agents
      </Typography>
      {view.agents.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          None available.
        </Typography>
      )}
      {view.agents.map((agent) =>
        agent.name == null ? (
          <Chip key={agent.id} size="small" color="warning" variant="outlined" label="Unnamed coding agent" onClick={onManage} />
        ) : (
          <Chip key={agent.id} size="small" label={agent.name} />
        ),
      )}
      <Button size="small" onClick={onManage}>
        Manage
      </Button>
    </Stack>
  );
}

/**
 * The agents and every thread, opened from the top bar or with its key:
 * the agents in a row at the top, managed in a dialog of their own, and
 * every thread of every module to go to and, while it waits for an agent,
 * to assign, stop or withdraw. Its badges count, top right in the attention
 * colour, the threads waiting for the spec owner and, bottom right, the
 * available agents.
 */
const AgentsControls = observer(function AgentsControls() {
  const { client, view } = useAgents();
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const waitsForSpecOwner = useWaitsForSpecOwner();
  const forYou = useEveryThread().filter(({ thread }) => waitsForSpecOwner(thread)).length;
  const available = view.agents.filter(({ name }) => name != null).length;
  const binding = useMemo<ShortcutBinding>(
    () => ({ id: "open-agents", ...agentsShortcut, when: (event) => !isEditableTarget(event.target) && !isOverlayTarget(event.target), action: () => setOpen(true) }),
    [],
  );
  useShortcut(binding);
  return (
    <>
      <ActionTooltip name="Agents and threads" shortcut={agentsShortcut}>
        <IconButton
          aria-label={`Agents and threads: ${forYou} ${forYou === 1 ? "thread waits" : "threads wait"} for you, ${available} ${available === 1 ? "agent" : "agents"} available`}
          onClick={() => setOpen(true)}
        >
          <Badge color="default" showZero badgeContent={available} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
            <Badge color="warning" badgeContent={forYou}>
              <SmartToy />
            </Badge>
          </Badge>
        </IconButton>
      </ActionTooltip>
      {/* A fixed height, so switching groups never resizes it. */}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="md" slotProps={{ paper: { sx: { height: "85vh" } } }}>
        <DialogTitle>Agents and threads</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Stack spacing={2} sx={{ flexGrow: 1, minHeight: 0 }}>
            <AgentsRow onManage={() => setManaging(true)} />
            <ThreadList onGo={() => setOpen(false)} />
          </Stack>
        </DialogContent>
      </Dialog>
      <Dialog open={managing} onClose={() => setManaging(false)} fullWidth maxWidth="sm">
        <DialogTitle>Agents</DialogTitle>
        <DialogContent>
          <AgentList agents={view.agents} actions={client} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManaging(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
});

export default AgentsControls;

/**
 * Asks the spec owner, before an action of theirs that concerns threads
 * agents have, whether to give it up or to stop those agents and carry it
 * out. The list follows the threads live: one no agent has any more drops
 * out.
 */
export function StopConfirmationHost() {
  const { client, view } = useAgents();
  const [asked, setAsked] = useState<{ keys: string[]; action: string; answer: (keys: string[] | null) => void } | null>(null);
  useEffect(() => {
    client.setConfirmer(
      (threads: readonly WaitingThreadState[], action: string) =>
        new Promise<string[] | null>((answer) => setAsked({ keys: threads.map(({ key }) => key), action, answer })),
    );
    return () => client.setConfirmer(null);
  }, [client]);
  if (asked == null) return null;
  const finish = (keys: string[] | null) => {
    setAsked(null);
    asked.answer(keys);
  };
  return (
    <StopConfirmation
      open
      action={asked.action}
      threads={view.waiting.filter(({ key }) => asked.keys.includes(key))}
      onGiveUp={() => finish(null)}
      onStopAndCarryOut={(keys) => finish(keys)}
      onCarryOut={() => finish([])}
    />
  );
}

/** That an agent is working on a module, once however many are, with a way to stop the agents behind it. */
export function ModuleWorkingSign({ moduleId }: { moduleId: string }) {
  const { client, view } = useAgents();
  return <WorkingSign view={view} place={{ kind: "module", moduleId }} onStop={(keys) => attempt(() => client.stopAgents(keys), "The agents could not be stopped.")} />;
}
