"use client";

import { SmartToy } from "@mui/icons-material";
import { Badge, Dialog, DialogContent, DialogTitle, Divider, IconButton, Typography } from "@mui/material";
import { useEffect, useMemo, useState } from "react";

import { ActionTooltip } from "actions/ActionHint";
import { notify } from "components/notices";
import { isEditableTarget, isOverlayTarget, type ShortcutBinding, useShortcut } from "hooks/shortcuts";
import { getUserFacingErrorMessage } from "lib/errors";

import type { RequestState } from "../desk";
import AgentList from "./AgentList";
import { useAgents } from "./context";
import RequestConfirmation from "./RequestConfirmation";
import { agentsShortcut } from "./shortcuts";
import WaitingRequests from "./WaitingRequests";
import WorkingSign from "./WorkingSign";

function attempt(request: () => Promise<unknown>, fallback: string): void {
  request().catch((error: unknown) => notify(getUserFacingErrorMessage(error, fallback), "error"));
}

/**
 * The agents and every waiting request, opened from the top bar or with its
 * key: each agent by its name, unnamed coding agents to name, the agents
 * Requireganizer runs to add, change and remove, and each request to give
 * or stop. Its badge counts the requests no agent has.
 */
export default function AgentsControls() {
  const { client, view, stageLabel } = useAgents();
  const [open, setOpen] = useState(false);
  const waitingForAgent = view.requests.filter(({ holder }) => holder == null).length;
  const binding = useMemo<ShortcutBinding>(
    () => ({ id: "open-agents", ...agentsShortcut, when: (event) => !isEditableTarget(event.target) && !isOverlayTarget(event.target), action: () => setOpen(true) }),
    [],
  );
  useShortcut(binding);
  return (
    <>
      <ActionTooltip name="Agents and waiting requests" shortcut={agentsShortcut}>
        <IconButton aria-label={`Agents and waiting requests, ${waitingForAgent} with no agent`} onClick={() => setOpen(true)}>
          <Badge color="warning" badgeContent={waitingForAgent}>
            <SmartToy />
          </Badge>
        </IconButton>
      </ActionTooltip>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Agents</DialogTitle>
        <DialogContent>
          <AgentList agents={view.agents} actions={client} />
          <Divider sx={{ my: 2 }} />
          <Typography variant="overline" color="text.secondary">
            Waiting requests
          </Typography>
          <WaitingRequests
            view={view}
            stageLabel={(_moduleId, stage) => stageLabel(stage)}
            onGive={(key, agentId) => attempt(() => client.giveRequest(key, agentId), "The request could not be given.")}
            onStop={(key) => attempt(() => client.stopRequests([key]), "The request could not be stopped.")}
            onWithdraw={(key) => attempt(() => client.withdrawRequest(key), "The request could not be withdrawn.")}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Asks the spec owner, before an action of theirs that concerns requests
 * agents have, whether to give it up or to stop them and carry it out. The
 * list follows the requests live: one no agent has any more drops out.
 */
export function RequestConfirmationHost() {
  const { client, view } = useAgents();
  const [asked, setAsked] = useState<{ keys: string[]; action: string; answer: (keys: string[] | null) => void } | null>(null);
  useEffect(() => {
    client.setConfirmer(
      (requests: readonly RequestState[], action: string) =>
        new Promise<string[] | null>((answer) => setAsked({ keys: requests.map(({ key }) => key), action, answer })),
    );
    return () => client.setConfirmer(null);
  }, [client]);
  if (asked == null) return null;
  const finish = (keys: string[] | null) => {
    setAsked(null);
    asked.answer(keys);
  };
  return (
    <RequestConfirmation
      open
      action={asked.action}
      requests={view.requests.filter(({ key }) => asked.keys.includes(key))}
      onGiveUp={() => finish(null)}
      onStopAndCarryOut={(keys) => finish(keys)}
      onCarryOut={() => finish([])}
    />
  );
}

/** That an agent is working on a module, once however many are, with a way to stop the requests behind it. */
export function ModuleWorkingSign({ moduleId }: { moduleId: string }) {
  const { client, view } = useAgents();
  return (
    <WorkingSign
      view={view}
      place={{ kind: "module", moduleId }}
      onStop={(keys) => attempt(() => client.stopRequests(keys), "The requests could not be stopped.")}
    />
  );
}
