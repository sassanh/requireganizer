"use client";

import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, List, ListItem, ListItemText } from "@mui/material";

import { labelOfId } from "agents";
import { useAgents } from "agents/ui";
import { howLongAgo, howLongSince } from "lib/elapsed";

import type { ConfirmationNote, WaitingThreadState } from "../desk";

/**
 * Asks the spec owner, before an action of theirs that may be a mistake,
 * whether to give it up or carry it out: each thread it concerns that an
 * agent has, with what it asks and since when the agent has it, whose agent
 * carrying it out stops; and each note, such as an agent reviewing its own
 * work. `threads` is read live, so a thread no agent has any more drops out,
 * and once none is left the action is offered without stopping any agent.
 */
export default function Confirmation({
  action,
  threads,
  notes = [],
  onGiveUp,
  onCarryOut,
}: {
  /** The action, as a verb phrase, such as "resolve the thread"; null when stopping the agents is the action itself. */
  action: string | null;
  /** The threads it concerns that an agent still has. */
  threads: readonly WaitingThreadState[];
  notes?: readonly ConfirmationNote[];
  onGiveUp: () => void;
  /** Carry it out, confirming the threads listed and the notes, by their keys. */
  onCarryOut: (keys: string[]) => void;
}) {
  const { view } = useAgents();
  const held = threads.filter(({ holder }) => holder != null);
  const capitalized = action == null ? "Stop" : action.charAt(0).toUpperCase() + action.slice(1);
  const these = held.length === 1 ? "the agent working on this thread" : "the agents working on these threads";
  const title =
    held.length === 0
      ? action == null
        ? "No agent works on these threads any more."
        : notes.length > 0
          ? `${capitalized}?`
          : `No agent works on a thread it concerns now. ${capitalized} without stopping any agent?`
      : action == null
        ? `Stop ${these}?`
        : `To ${action}, stop ${these}?`;
  const keys = [...held.map(({ key }) => key), ...notes.map(({ key }) => key)];
  return (
    <Dialog open onClose={onGiveUp} aria-labelledby="confirmation-title">
      <DialogTitle id="confirmation-title">{title}</DialogTitle>
      {(held.length > 0 || notes.length > 0) && (
        <DialogContent>
          {notes.map((note) => (
            <DialogContentText key={note.key}>{note.text}</DialogContentText>
          ))}
          {held.length > 0 && (
            <List dense>
              {held.map((waiting) => (
                <ListItem key={waiting.key} disableGutters>
                  <ListItemText
                    primary={waiting.summary}
                    secondary={`${labelOfId(view.agents, waiting.holder!.agentId) ?? "An agent"} has had it ${howLongSince(waiting.holder!.since)}, assigned ${howLongAgo(waiting.holder!.since)}`}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
      )}
      <DialogActions>
        {(action != null || held.length > 0) && <Button onClick={onGiveUp}>{action == null ? "Keep working" : "Give up"}</Button>}
        {action == null && held.length === 0 ? (
          <Button variant="contained" autoFocus onClick={onGiveUp}>
            Close
          </Button>
        ) : (
          <Button variant="contained" autoFocus onClick={() => onCarryOut(keys)}>
            {held.length === 0 ? capitalized : action == null ? "Stop" : `Stop and ${action}`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
