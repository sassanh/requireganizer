"use client";

import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
} from "@mui/material";
import { useState } from "react";

import { getUserFacingErrorMessage } from "lib/errors";
import { useProject } from "projectContext";
import { DEFAULT_EXPORT_OPTIONS, type ExportOptions, type ListedRestorePoint } from "storage-and-recovery";

type ThreadsChoice = "all" | "open" | "none";

/**
 * Export the open project, or one of its restore points, to a file import
 * accepts, choosing which threads and signatures it holds. It starts at the
 * whole project, threads and signatures with their times. Mounted per
 * export, so every export starts there.
 */
export default function ExportDialog({
  restorePoint,
  onClose,
}: {
  /** The restore point to export; the project as it is now when absent. */
  restorePoint?: ListedRestorePoint;
  onClose: () => void;
}) {
  const { exportProject } = useProject();
  const defaults = DEFAULT_EXPORT_OPTIONS.threads;
  const [threads, setThreads] = useState<ThreadsChoice>(defaults === "none" ? "none" : defaults.which);
  const [threadTimes, setThreadTimes] = useState(defaults === "none" || defaults.withTimes);
  const [signatures, setSignatures] = useState<ExportOptions["signatures"]>(DEFAULT_EXPORT_OPTIONS.signatures);
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async () => {
    setWorking(true);
    setFailure(null);
    try {
      await exportProject(
        { threads: threads === "none" ? "none" : { which: threads, withTimes: threadTimes }, signatures },
        restorePoint,
      );
      onClose();
    } catch (error) {
      console.error("Could not export the project.", error);
      setFailure(getUserFacingErrorMessage(error, "The export failed. Try again."));
    } finally {
      setWorking(false);
    }
  };

  const title =
    restorePoint == null
      ? "Export the project"
      : `Export the restore point ${restorePoint.name == null ? "made automatically" : `“${restorePoint.name}”`} of ${new Date(restorePoint.at).toLocaleString()}`;

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2 }}>
          <FormControl>
            <FormLabel id="export-threads">Threads</FormLabel>
            <RadioGroup
              row
              aria-labelledby="export-threads"
              value={threads}
              onChange={(event) => setThreads(event.target.value as ThreadsChoice)}
            >
              <FormControlLabel value="all" control={<Radio />} label="All" />
              <FormControlLabel value="open" control={<Radio />} label="Open only" />
              <FormControlLabel value="none" control={<Radio />} label="None" />
            </RadioGroup>
            <FormControlLabel
              disabled={threads === "none"}
              control={<Checkbox checked={threadTimes} onChange={(event) => setThreadTimes(event.target.checked)} />}
              label="With the times of messages and resolutions"
            />
          </FormControl>
          <FormControl>
            <FormLabel id="export-signatures">Signatures</FormLabel>
            <RadioGroup
              aria-labelledby="export-signatures"
              value={signatures}
              onChange={(event) => setSignatures(event.target.value as ExportOptions["signatures"])}
            >
              <FormControlLabel value="with times" control={<Radio />} label="With their times" />
              <FormControlLabel value="without times" control={<Radio />} label="Without their times" />
              <FormControlLabel value="none" control={<Radio />} label="None" />
            </RadioGroup>
            {signatures === "none" && (
              <FormHelperText>Every item, coverage and impact comes unsigned, and items whose removal you signed are left out.</FormHelperText>
            )}
          </FormControl>
          {failure != null && <Alert severity="error">{failure}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={working} onClick={() => void submit()}>
          Export
        </Button>
      </DialogActions>
    </Dialog>
  );
}
