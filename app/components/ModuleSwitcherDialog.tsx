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
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { useState } from "react";

import { useProject } from "projectContext";

import { NameField, RenameableName, RenameButton } from "./RenameableName";

interface ModuleSwitcherDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Cmd+Shift+M overlay: the product, named by its project, and its modules.
 * Navigates, adds, renames and archives modules, and hosts the one-time
 * dialog that enables modules for a project.
 */
export default function ModuleSwitcherDialog({
  open,
  onClose,
}: ModuleSwitcherDialogProps) {
  const {
    activeProject,
    modules,
    modulesEnabled,
    enableModules,
    addModule,
    switchModule,
    archiveModule,
    renameModule,
    renameProject,
  } = useProject();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setNameDraft("");
    setAdding(false);
    setRenamingId(null);
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const submitName = async () => {
    try {
      if (modulesEnabled) {
        await addModule(nameDraft);
      } else {
        await enableModules(nameDraft);
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
      <DialogTitle component="div">
        {activeProject == null ? (
          "Modules"
        ) : (
          <RenameableName name={activeProject.name} label="Project" rename={renameProject} variant="h6" />
        )}
      </DialogTitle>
      <DialogContent>
        {errorLine}
        <Typography variant="overline" color="text.secondary">
          Modules
        </Typography>
        <List disablePadding>
          {modules.map((module) => renamingId === module.id ? (
            <ListItem key={module.id} disableGutters>
              <NameField
                name={module.name}
                label="Module"
                rename={(name) => renameModule(module.id, name)}
                onDone={() => setRenamingId(null)}
              />
            </ListItem>
          ) : (
            <ListItem
              key={module.id}
              disableGutters
              secondaryAction={
                <Stack direction="row">
                <RenameButton name={module.name} label="Module" onClick={() => setRenamingId(module.id)} />
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
                      onClick={() => void archiveModule(module.id)}
                    >
                      <Archive fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                </Stack>
              }
            >
              <ListItemButton
                selected={module.active}
                disabled={module.active}
                onClick={() => {
                  void switchModule(module.id);
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
