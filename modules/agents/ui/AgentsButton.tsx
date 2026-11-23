"use client";

import { SmartToy } from "@mui/icons-material";
import { Badge, IconButton } from "@mui/material";
import { useMemo, useState } from "react";

import { ActionTooltip } from "actions/ActionHint";
import { isEditableTarget, isOverlayTarget, type ShortcutBinding, useShortcut } from "hooks/shortcuts";

import AgentsDialog from "./AgentsDialog";
import { useAgents } from "./context";
import { agentsShortcut } from "./shortcuts";

/** Opens the agents and templates, from the top bar or with its key; its badge counts the coding agents asking to be let in. */
export default function AgentsButton() {
  const { view } = useAgents();
  const [open, setOpen] = useState(false);
  const asking = view.agents.filter((agent) => agent.askingToLetIn).length;
  const binding = useMemo<ShortcutBinding>(
    () => ({ id: "open-agents", ...agentsShortcut, when: (event) => !isEditableTarget(event.target) && !isOverlayTarget(event.target), action: () => setOpen(true) }),
    [],
  );
  useShortcut(binding);
  return (
    <>
      <ActionTooltip name="Agents" shortcut={agentsShortcut}>
        <IconButton aria-label={asking === 0 ? "Agents" : `Agents: ${asking} ${asking === 1 ? "asks" : "ask"} to be let in`} onClick={() => setOpen(true)}>
          <Badge color="warning" badgeContent={asking}>
            <SmartToy />
          </Badge>
        </IconButton>
      </ActionTooltip>
      <AgentsDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
