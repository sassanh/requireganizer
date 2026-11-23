"use client";

import { ArrowDropDown, Send } from "@mui/icons-material";
import { Button, Divider, ListItemText, Menu, MenuItem } from "@mui/material";
import { useEffect, useRef, useState } from "react";

import type { AssignTarget } from "../host";
import type { AgentChoice, Choices, TemplateChoice } from "./choices";

/** The choices open now, by the place they send to, so a key can open them where no button was pressed. */
const openers = new Map<string, () => void>();

/** Open the choice of whom to send to at a place, as its button would; false when none is shown there. */
export function openSendChoice(place: string): boolean {
  const open = openers.get(place);
  open?.();
  return open != null;
}

/**
 * Sends a message, or asks for a stage, and assigns its thread in the same
 * act, to the agent the spec owner chooses: the button opens the choice,
 * with the offered agents first, no agent, and every other agent and a new
 * internal agent from each template once they ask for more. Each agent that
 * cannot take the thread is shown with why. The system never picks one.
 */
export default function SendChoice({
  label,
  choices,
  place,
  disabled = false,
  variant = "contained",
  onSend,
}: {
  /** What sending does, such as "Send". */
  label: string;
  choices: Choices;
  /** Names where it sends, for a key to open it; none when no key does. */
  place?: string;
  disabled?: boolean;
  variant?: "contained" | "outlined" | "text";
  onSend: (to: AssignTarget | null) => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (place == null || disabled) return;
    const open = () => setAnchor(button.current);
    openers.set(place, open);
    return () => {
      if (openers.get(place) === open) openers.delete(place);
    };
  }, [place, disabled]);
  const close = () => {
    setAnchor(null);
    setMore(false);
  };
  const send = (to: AssignTarget | null) => {
    close();
    onSend(to);
  };
  // Once the spec owner asks for more, the first of the choices shown takes the focus, so the keys move through them.
  const firstMore = [...choices.others, ...choices.templates].find(({ problem }) => problem == null)?.id;
  const agentItem = (choice: AgentChoice) => (
    <MenuItem key={choice.id} autoFocus={more && choice.id === firstMore} disabled={choice.problem != null} onClick={() => send({ agent: choice.id })}>
      <ListItemText primary={`${label} to ${choice.label}`} secondary={choice.problem} />
    </MenuItem>
  );
  const templateItem = (choice: TemplateChoice) => (
    <MenuItem key={choice.id} autoFocus={more && choice.id === firstMore} disabled={choice.problem != null} onClick={() => send({ template: choice.id })}>
      <ListItemText primary={`${label} to a new agent from ${choice.name}`} secondary={choice.problem} />
    </MenuItem>
  );
  const hasMore = choices.others.length > 0 || choices.templates.length > 0;
  return (
    <>
      <Button
        ref={button}
        size="small"
        variant={variant}
        startIcon={<Send />}
        endIcon={<ArrowDropDown />}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={anchor != null}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        {label}
      </Button>
      <Menu anchorEl={anchor} open={anchor != null} onClose={close}>
        {choices.offered.map(agentItem)}
        <MenuItem onClick={() => send(null)}>
          <ListItemText primary={`${label} to no agent`} />
        </MenuItem>
        {hasMore && <Divider />}
        {hasMore && !more && (
          <MenuItem onClick={() => setMore(true)}>
            <ListItemText primary="More agents…" />
          </MenuItem>
        )}
        {more && choices.others.map(agentItem)}
        {more && choices.templates.map(templateItem)}
      </Menu>
    </>
  );
}
