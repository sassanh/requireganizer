import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import { getUserFacingErrorMessage } from "lib/errors";
import type { OutsideChange } from "persistence";
import { useProject } from "projectContext";
import { useStore } from "store";

/**
 * Shown while the stored project differs from the one shown here because
 * something else changed it, such as a checkout of the project file. The
 * person keeps one version; nothing else can be done until then.
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
  const { storage, openChangedProject, keepShownProject } = useProject();
  const store = useStore();
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
  const problem = outsideChange.kind === "changed" ? outsideChange.problem : null;
  const openable = outsideChange.kind === "changed" && problem == null;
  return (
    <Dialog open maxWidth="sm" fullWidth>
      <DialogTitle>
        {storage.name} {outsideChange.kind === "removed" ? "was removed" : "changed"} outside Requireganizer
      </DialogTitle>
      <DialogContent>
        {problem != null && <Alert severity="error" sx={{ mb: 2 }}>{problem}</Alert>}
        {openable && (
          <DialogContentText>
            {store.isBusy
              ? `The changed file can be opened once ${store.thinkingLabel ?? "the current work"} finishes.`
              : "Opening the changed file keeps this version one undo away."}
          </DialogContentText>
        )}
        {failure != null && <Alert severity="error" sx={{ mt: 2 }}>{failure}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button
          disabled={working || problem != null}
          color="warning"
          onClick={() => void run(keepShownProject, "This version could not be written.")}
        >
          {outsideChange.kind === "removed" ? "Write this version again" : "Keep this version"}
        </Button>
        {outsideChange.kind === "changed" && (
          <Button
            disabled={working || !openable || store.isBusy}
            variant="contained"
            onClick={() => void run(openChangedProject, "The changed file could not be opened.")}
          >
            Open the changed file
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
});

export default observer(OutsideChangeDialog);
