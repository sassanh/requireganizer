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
import { getUserFacingErrorMessage } from "lib/errors";
import { useProject } from "projectContext";

import ExportDialog from "./ExportDialog";
import PersistentAlert from "./PersistentAlert";

/** The project-actions menu anchored in the top bar: modules, import and export. */
export default function ProjectActionsMenu({
  onShowModules,
}: {
  onShowModules: () => void;
}) {
  const { modulesEnabled, importProjectFile } = useProject();
  const inputRef = useRef<HTMLInputElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [exporting, setExporting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const close = () => setAnchor(null);

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      await importProjectFile(await file.text(), file.name);
      setFailure(null);
    } catch (error) {
      console.error("Could not import the file.", error);
      setFailure(getUserFacingErrorMessage(error, `${file.name} was not imported, and nothing changed. Try again.`));
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
          <ListItemText>Import in place of this project</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            close();
            setExporting(true);
          }}
        >
          <ListItemIcon>
            <DataObject fontSize="small" />
          </ListItemIcon>
          <ListItemText>Export…</ListItemText>
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

      {exporting && <ExportDialog onClose={() => setExporting(false)} />}

      {failure && (
        <PersistentAlert severity="error" onClose={() => setFailure(null)}>
          {failure}
        </PersistentAlert>
      )}
    </>
  );
}
