"use client";

import { Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText } from "@mui/material";

import type { WaitingThreadState } from "../desk";
import { howLongAgo } from "./time";

/**
 * Asks the spec owner, before an action of theirs that concerns threads
 * agents have, whether to give it up or to stop those agents and carry it
 * out. `threads` is read live: a thread no agent has any more drops out,
 * and once none is left the action can be carried out as it is.
 */
export default function StopConfirmation({
  open,
  action,
  threads,
  onGiveUp,
  onStopAndCarryOut,
  onCarryOut,
}: {
  open: boolean;
  /** The action, as a verb phrase, such as "resolve the thread"; null when stopping the agents is the action itself. */
  action: string | null;
  /** The threads it concerns that an agent still has. */
  threads: readonly WaitingThreadState[];
  onGiveUp: () => void;
  onStopAndCarryOut: (keys: string[]) => void;
  onCarryOut: () => void;
}) {
  const held = threads.filter(({ holder }) => holder != null);
  const capitalized = action == null ? "Close" : action.charAt(0).toUpperCase() + action.slice(1);
  const these = held.length === 1 ? "the agent working on this thread" : "the agents working on these threads";
  const title = held.length === 0
    ? (action == null ? "No agent works on these threads any more." : `No agent works on a thread it concerns now. ${capitalized}?`)
    : (action == null ? `Stop ${these}?` : `To ${action}, stop ${these}?`);
  return (
    <Dialog open={open} onClose={onGiveUp} aria-labelledby="stop-confirmation-title">
      <DialogTitle id="stop-confirmation-title">
        {title}
      </DialogTitle>
      {held.length > 0 && (
        <DialogContent>
          <List dense>
            {held.map((waiting) => (
              <ListItem key={waiting.key} disableGutters>
                <ListItemText primary={waiting.summary} secondary={`${waiting.holder!.name}, assigned ${howLongAgo(waiting.holder!.since)}`} />
              </ListItem>
            ))}
          </List>
        </DialogContent>
      )}
      <DialogActions>
        {action != null ? <Button onClick={onGiveUp}>Give up</Button> : held.length > 0 && <Button onClick={onGiveUp}>Keep working</Button>}
        {held.length === 0 ? (
          <Button variant="contained" autoFocus onClick={onCarryOut}>
            {capitalized}
          </Button>
        ) : (
          <Button variant="contained" autoFocus onClick={() => onStopAndCarryOut(held.map(({ key }) => key))}>
            {action == null ? "Stop" : `Stop and ${action}`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
