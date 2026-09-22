"use client";

import { Add, Archive, Check } from "@mui/icons-material";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useState } from "react";

import { useProject } from "provider";

interface ModuleSwitcherDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Cmd+Shift+M overlay: navigates the visible modules, adds one, archives
 * one, and hosts the one-time dialog that enables modules for a project.
 */
export default function ModuleSwitcherDialog({
  open,
  onClose,
}: ModuleSwitcherDialogProps) {
  const { modules, modulesEnabled, enableModules, addModule, switchModule, archiveModule } =
    useProject();
  const [nameDraft, setNameDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setNameDraft("");
    setAdding(false);
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const submitName = () => {
    try {
      if (modulesEnabled) {
        addModule(nameDraft);
      } else {
        enableModules(nameDraft);
      }
      close();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "That name cannot be used.",
      );
    }
  };

  const errorLine =
    error == null ? null : (
      <Typography variant="body2" color="error" sx={{ pb: 1 }}>
        {error}
      </Typography>
    );

  if (!modulesEnabled) {
    return (
      <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
        <DialogTitle>Enable modules</DialogTitle>
        <DialogContent>
          {errorLine}
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

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
      <DialogTitle>Modules</DialogTitle>
      <DialogContent>
        {errorLine}
        <List disablePadding>
          {modules.map((module) => (
            <ListItem
              key={module.id}
              disableGutters
              secondaryAction={
                <Tooltip
                  title={
                    module.active
                      ? "Switch away before archiving this module"
                      : modules.length <= 1
                        ? "The last module cannot be archived"
                        : `Archive ${module.name}`
                  }
                >
                  <span>
                    <IconButton
                      edge="end"
                      aria-label={`Archive ${module.name}`}
                      disabled={module.active || modules.length <= 1}
                      onClick={() => archiveModule(module.id)}
                    >
                      <Archive fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              }
            >
              <ListItemButton
                selected={module.active}
                disabled={module.active}
                onClick={() => {
                  switchModule(module.id);
                  close();
                }}
              >
                <ListItemText primary={module.name} />
                {module.active ? <Check color="primary" fontSize="small" /> : null}
              </ListItemButton>
            </ListItem>
          ))}
        </List>
        {adding ? (
          <TextField
            autoFocus
            fullWidth
            label="Module name"
            value={nameDraft}
            error={error != null}
            sx={{ mt: 2 }}
            onChange={(event) => setNameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitName();
            }}
          />
        ) : (
          <Button startIcon={<Add />} sx={{ mt: 1 }} onClick={() => setAdding(true)}>
            New module
          </Button>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>Close</Button>
        {adding && (
          <Button onClick={submitName} disabled={nameDraft.trim().length === 0}>
            Add
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
