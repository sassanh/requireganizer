"use client";

import {
  DataObject,
  Menu as MenuIcon,
  SystemUpdateAlt,
  ViewModule,
} from "@mui/icons-material";
import {
  Box,
  Button,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from "@mui/material";
import { useRef, useState, ChangeEvent } from "react";

import { ShortcutLabel } from "actions/ActionHint";
import { switchModuleShortcut } from "actions/actions";
import { parseJson } from "lib/json";
import { useProject } from "projectContext";

import PersistentAlert from "./PersistentAlert";

/** The project-actions menu anchored in the top bar: modules, import and export. */
export default function ProjectActionsMenu({
  onShowModules,
}: {
  onShowModules: () => void;
}) {
  const { modulesEnabled, importProjectFile, exportProject } = useProject();
  const inputRef = useRef<HTMLInputElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const close = () => setAnchor(null);

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const data = parseJson(await file.text(), "Imported project");
      await importProjectFile(data);
      setImportError(null);
    } catch (error) {
      console.error("Could not import project data.", error);
      setImportError(
        error instanceof Error
          ? error.message
          : "The selected file is not a valid Requireganizer project.",
      );
    }
  };

  return (
    <>
      <Button
        variant="outlined"
        aria-label="Project actions"
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{ minWidth: 0, px: 1.25 }}
      >
        <MenuIcon />
      </Button>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={close}>
        <MenuItem
          onClick={() => {
            close();
            inputRef.current?.click();
          }}
        >
          <ListItemIcon>
            <SystemUpdateAlt fontSize="small" />
          </ListItemIcon>
          <ListItemText>Import JSON</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            close();
            exportProject();
          }}
        >
          <ListItemIcon>
            <DataObject fontSize="small" />
          </ListItemIcon>
          <ListItemText>Export as JSON</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            close();
            onShowModules();
          }}
        >
          <ListItemIcon>
            <ViewModule fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary={
              <Box
                component="span"
                sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 2 }}
              >
                <Box component="span">
                  {modulesEnabled ? "Modules" : "Enable modules"}
                </Box>
                <ShortcutLabel shortcut={switchModuleShortcut} />
              </Box>
            }
          />
        </MenuItem>
      </Menu>

      <input
        hidden
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleImportFile}
      />

      {importError && (
        <PersistentAlert severity="error" onClose={() => setImportError(null)}>
          {importError}
        </PersistentAlert>
      )}
    </>
  );
}
