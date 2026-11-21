"use client";

import { ArrowDropDown, Send } from "@mui/icons-material";
import { Button, ButtonGroup, ListItemText, Menu, MenuItem, Stack, Typography } from "@mui/material";
import { useState } from "react";

import type { AgentId } from "../roster";

type Agent = { id: AgentId; name: string };

/**
 * The agent a thread is assigned to as the spec owner sends a message in it
 * with no other choice made: the agent that last replied in it, while it is
 * available, else the only available agent, while exactly one is, else
 * none; never one of `available` the thread cannot be assigned to now.
 */
export function preferredAgent(available: readonly Agent[], assignable: readonly Agent[], lastReplier: string | null): AgentId | null {
  const can = (agent: Agent | undefined) => agent != null && assignable.some(({ id }) => id === agent.id);
  const replied = lastReplier == null ? undefined : available.find(({ name }) => name === lastReplier);
  if (can(replied)) return replied!.id;
  const only = available.length === 1 ? available[0] : undefined;
  return can(only) ? only!.id : null;
}

/**
 * Sends a message and assigns its thread in the same act. The button itself
 * sends to the preferred agent, or to none; the chevron lists every other
 * agent the thread can be assigned to, and no agent. A note, when given,
 * says why fewer agents are offered than are available.
 */
export default function SendButton({
  label,
  agents,
  preferred,
  note = null,
  disabled = false,
  onSend,
}: {
  /** What sending does, such as "Send". */
  label: string;
  /** The agents the thread can be assigned to now. */
  agents: readonly Agent[];
  /** The agent the button itself sends to; null for none. */
  preferred: AgentId | null;
  note?: string | null;
  disabled?: boolean;
  onSend: (to: AgentId | null) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuOpen = anchor != null;
  const closeMenu = () => setAnchor(null);
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
  const chosen = agents.find(({ id }) => id === preferred) ?? null;
  const others = agents.filter((agent) => agent !== chosen);
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
      {note != null && (
        <Typography variant="caption" color="text.secondary">
          {note}
        </Typography>
      )}
      <ButtonGroup size="small" variant="contained" disabled={disabled}>
        <Button startIcon={<Send />} onClick={() => send(chosen?.id ?? null)}>
          {chosen == null ? `${label} to no agent` : `${label} to ${chosen.name}`}
        </Button>
        <Button aria-label={`${label} to another agent`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={(event) => setAnchor(event.currentTarget.parentElement)}>
          <ArrowDropDown />
        </Button>
      </ButtonGroup>
      <Menu anchorEl={anchor} open={menuOpen} onClose={closeMenu}>
        {others.map((agent) => (
          <MenuItem key={agent.id} onClick={() => send(agent.id)}>
            <ListItemText>{`${label} to ${agent.name}`}</ListItemText>
          </MenuItem>
        ))}
        {chosen != null && (
          <MenuItem onClick={() => send(null)}>
            <ListItemText>{`${label} to no agent`}</ListItemText>
          </MenuItem>
        )}
      </Menu>
    </Stack>
  );
}
