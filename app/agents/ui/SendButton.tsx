"use client";

import { ArrowDropDown, Send } from "@mui/icons-material";
import { Button, ButtonGroup, ListItemText, Menu, MenuItem, Stack, Typography } from "@mui/material";
import { useState } from "react";

import type { AgentId } from "../roster";

/** The agent a request goes to with no choice made: the one agent it can go to, if exactly one; else none. */
export function agentWithNoChoice(agents: readonly { id: AgentId }[]): AgentId | null {
  return agents.length === 1 ? agents[0]!.id : null;
}

/**
 * Makes a request and gives it to an agent in the same act. With exactly
 * one agent to give it to, it goes to that agent unless the spec owner
 * chooses none from the chevron; with more, the chevron lists every one.
 * A note, when given, says why fewer agents are offered than are available.
 */
export default function SendButton({
  label,
  agents,
  note = null,
  disabled = false,
  onSend,
}: {
  /** What sending does, such as "Send change request". */
  label: string;
  /** The agents the request can be given to now. */
  agents: readonly { id: AgentId; name: string }[];
  note?: string | null;
  disabled?: boolean;
  onSend: (to: AgentId | null) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuOpen = anchor != null;
  const closeMenu = () => setAnchor(null);
  const only = agents.length === 1 ? agents[0]! : null;
  const send = (to: AgentId | null) => {
    closeMenu();
    onSend(to);
  };
  if (agents.length === 0) {
    return (
      <Button size="small" variant="contained" startIcon={<Send />} disabled={disabled} onClick={() => send(null)}>
        {label}
      </Button>
    );
  }
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
      {note != null && (
        <Typography variant="caption" color="text.secondary">
          {note}
        </Typography>
      )}
      <ButtonGroup size="small" variant="contained" disabled={disabled}>
        <Button startIcon={<Send />} onClick={() => send(agentWithNoChoice(agents))}>
          {only == null ? `${label} to no agent` : `${label} to ${only.name}`}
        </Button>
        <Button aria-label={only == null ? `${label} to an agent` : `${label} to no agent`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={(event) => setAnchor(event.currentTarget.parentElement)}>
          <ArrowDropDown />
        </Button>
      </ButtonGroup>
      <Menu anchorEl={anchor} open={menuOpen} onClose={closeMenu}>
        {only == null ? (
          agents.map((agent) => (
            <MenuItem key={agent.id} onClick={() => send(agent.id)}>
              <ListItemText>{`${label} to ${agent.name}`}</ListItemText>
            </MenuItem>
          ))
        ) : (
          <MenuItem onClick={() => send(null)}>
            <ListItemText>{`${label} to no agent`}</ListItemText>
          </MenuItem>
        )}
      </Menu>
    </Stack>
  );
}
