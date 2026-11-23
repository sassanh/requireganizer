"use client";

import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";

import { attempt } from "components/notices";

import { detailLines } from "./AgentsDialog";
import { useAgents } from "./context";

/**
 * Asks the spec owner whether to let in each coding agent that named itself
 * or whose session connected again, one at a time, with the name it gave
 * itself and what its connection tells of it.
 */
export default function LetInPrompt() {
  const { client, view } = useAgents();
  const asking = view.agents.find((agent) => agent.askingToLetIn);
  if (asking == null) return null;
  const answer = (letIn: boolean) => attempt(() => client.answerLetIn(asking.id, letIn), "The answer could not be given.");
  return (
    <Dialog open aria-labelledby="let-in-title" onClose={() => {}}>
      <DialogTitle id="let-in-title">Let in the coding agent “{asking.name}”?</DialogTitle>
      <DialogContent>
        <DialogContentText component="ul" sx={{ m: 0, pl: 2 }}>
          {detailLines(asking.details).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </DialogContentText>
        <DialogContentText sx={{ mt: 1 }}>Until you let it in, it can only name itself.</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => answer(false)}>Refuse</Button>
        <Button variant="contained" autoFocus onClick={() => answer(true)}>
          Let in
        </Button>
      </DialogActions>
    </Dialog>
  );
}
