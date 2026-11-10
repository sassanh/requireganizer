import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import { getUserFacingErrorMessage } from "lib/errors";
import { useProject } from "projectContext";
import type { OutsideChange } from "storage-and-recovery";

/**
 * Shown while the stored project differs from the one Requireganizer last
 * wrote because something else changed or removed it, such as a checkout of
 * the project file. The spec owner keeps one of the two, or leaves a
 * removed one removed; nothing changes until then.
 */
const OutsideChangeDialog = () => {
  const { outsideChange } = useProject();
  // Mounted per change, so a failure never outlives the change it was about.
  // The adapter reports a change only when it differs from the last one.
  return outsideChange == null ? null : (
    <OutsideChangeChoice key={JSON.stringify(outsideChange)} outsideChange={outsideChange} />
  );
};

const OutsideChangeChoice = observer(({ outsideChange }: { outsideChange: OutsideChange }) => {
  const { storage, openChangedProject, keepShownProject, leaveProjectRemoved } = useProject();
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const run = async (choice: () => Promise<void>, fallback: string) => {
    setWorking(true);
    setFailure(null);
    try {
      await choice();
    } catch (error) {
      setFailure(getUserFacingErrorMessage(error, fallback));
    } finally {
      setWorking(false);
    }
  };
  const removed = outsideChange.kind === "removed";
  const problem = outsideChange.kind === "changed" ? outsideChange.problem : null;
  const openable = outsideChange.kind === "changed" && problem == null;
  return (
    <Dialog open maxWidth="sm" fullWidth>
      <DialogTitle>
        {storage.name} {removed ? "was removed" : "changed"} outside Requireganizer
      </DialogTitle>
      <DialogContent>
        {problem != null && <Alert severity="error" sx={{ mb: 2 }}>{problem}</Alert>}
        {removed && (
          <DialogContentText>
            Write the project on screen back, or leave it removed and close the project, forgetting its history.
          </DialogContentText>
        )}
        {openable && <DialogContentText>Opening the changed project can be undone.</DialogContentText>}
        {failure != null && <Alert severity="error" sx={{ mt: 2 }}>{failure}</Alert>}
      </DialogContent>
      <DialogActions>
        {removed && (
          <Button
            disabled={working}
            color="warning"
            onClick={() => void run(leaveProjectRemoved, "The project's history could not be forgotten. Try again.")}
          >
            Leave it removed
          </Button>
        )}
        <Button
          disabled={working}
          color={removed ? "primary" : "warning"}
          variant={removed ? "contained" : "text"}
          onClick={() => void run(keepShownProject, "The project on screen could not be written.")}
        >
          {removed ? "Write it back" : "Keep the project on screen"}
        </Button>
        {openable && (
          <Button
            disabled={working}
            variant="contained"
            onClick={() => void run(openChangedProject, "The changed project could not be opened.")}
          >
            Open the changed project
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
});

export default observer(OutsideChangeDialog);
