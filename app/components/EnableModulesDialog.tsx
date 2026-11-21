"use client";

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";

import { useProject } from "projectContext";

interface EnableModulesDialogProps {
  open: boolean;
  onClose: () => void;
}

/** The one-time dialog that enables modules for a project, naming its first module. */
export default function EnableModulesDialog({
  open,
  onClose,
}: EnableModulesDialogProps) {
  const { enableModules } = useProject();
  const [nameDraft, setNameDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setNameDraft("");
    setError(null);
    onClose();
  };

  const submitName = async () => {
    try {
      await enableModules(nameDraft);
      close();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "That name cannot be used.",
      );
    }
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
      <DialogTitle>Enable modules</DialogTitle>
      <DialogContent>
        {error != null && (
          <Typography variant="body2" color="error" sx={{ pb: 1 }}>
            {error}
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ pb: 2 }}>
          This project&apos;s existing work becomes its first module.
        </Typography>
        <TextField
          autoFocus
          fullWidth
          label="First module name"
          value={nameDraft}
          error={error != null}
          onChange={(event) => setNameDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitName();
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button onClick={submitName} disabled={nameDraft.trim().length === 0}>
          Enable
        </Button>
      </DialogActions>
    </Dialog>
  );
}
