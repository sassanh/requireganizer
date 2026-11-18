"use client";

import { Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText } from "@mui/material";

import type { RequestState } from "../desk";
import { howLongAgo } from "./time";

/**
 * Asks the spec owner, before an action of theirs that concerns requests
 * agents have, whether to give it up or to stop those requests and carry it
 * out. `requests` is read live: a request no agent has any more drops out,
 * and once none is left the action can be carried out as it is.
 */
export default function RequestConfirmation({
  open,
  action,
  requests,
  onGiveUp,
  onStopAndCarryOut,
  onCarryOut,
}: {
  open: boolean;
  /** The action, as a verb phrase, such as "resolve the thread"; null when stopping the requests is the action itself. */
  action: string | null;
  /** The requests it concerns that an agent still has. */
  requests: readonly RequestState[];
  onGiveUp: () => void;
  onStopAndCarryOut: (keys: string[]) => void;
  onCarryOut: () => void;
}) {
  const held = requests.filter(({ holder }) => holder != null);
  const capitalized = action == null ? "Close" : action.charAt(0).toUpperCase() + action.slice(1);
  const these = held.length === 1 ? "this request" : "these requests";
  const title = held.length === 0
    ? (action == null ? "No agent has these requests any more." : `No agent has a request it concerns now. ${capitalized}?`)
    : (action == null ? `Stop ${these}?` : `To ${action}, stop ${these}?`);
  return (
    <Dialog open={open} onClose={onGiveUp} aria-labelledby="request-confirmation-title">
      <DialogTitle id="request-confirmation-title">
        {title}
      </DialogTitle>
      {held.length > 0 && (
        <DialogContent>
          <List dense>
            {held.map((request) => (
              <ListItem key={request.key} disableGutters>
                <ListItemText primary={request.summary} secondary={`${request.holder!.name}, given ${howLongAgo(request.holder!.since)}`} />
              </ListItem>
            ))}
          </List>
        </DialogContent>
      )}
      <DialogActions>
        <Button onClick={onGiveUp}>Give up</Button>
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
