"use client";

import { ArrowDropDown, Send } from "@mui/icons-material";
import { Button, ButtonGroup, ListItemText, Menu, MenuItem } from "@mui/material";
import { useState } from "react";

import type { AgentId } from "../roster";

/**
 * Makes a request and gives it to an agent in the same act. With exactly
 * one agent to give it to, it goes to that agent unless the spec owner
 * chooses none from the chevron; with more, the chevron lists every one.
 */
export default function SendButton({
  label,
  agents,
  disabled = false,
  onSend,
}: {
  /** What sending does, such as "Send change request". */
  label: string;
  /** The agents the request can be given to now. */
  agents: readonly { id: AgentId; name: string }[];
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
    <>
      <ButtonGroup size="small" variant="contained" disabled={disabled}>
        <Button startIcon={<Send />} onClick={() => send(only?.id ?? null)}>
          {only == null ? `${label} to no agent` : `${label} to ${only.name}`}
        </Button>
        <Button aria-label={`${label} to another agent`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={(event) => setAnchor(event.currentTarget.parentElement)}>
          <ArrowDropDown />
        </Button>
      </ButtonGroup>
      <Menu anchorEl={anchor} open={menuOpen} onClose={closeMenu}>
        {agents.map((agent) => (
          <MenuItem key={agent.id} onClick={() => send(agent.id)}>
            <ListItemText>{`${label} to ${agent.name}`}</ListItemText>
          </MenuItem>
        ))}
        {only != null && (
          <MenuItem onClick={() => send(null)}>
            <ListItemText>{`${label} to no agent`}</ListItemText>
          </MenuItem>
        )}
      </Menu>
    </>
  );
}
