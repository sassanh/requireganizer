"use client";

import {
  DataObject,
  FileDownload,
  FileUpload,
  FolderZip,
  Menu as MenuIcon,
  MenuBook,
  PictureAsPdf,
  SystemUpdateAlt,
} from "@mui/icons-material";
import {
  Button,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from "@mui/material";
import { useRef, useState, ChangeEvent } from "react";

import { parseJson } from "lib/json";
import { useStore } from "store";

import PersistentAlert from "./PersistentAlert";

type CodeArchiveFormat = "zip" | "tar.gz" | "tar.bz2";
type ProjectExportFormat = "pdf" | "txt" | "json";

/**
 * The project-actions menu anchored in the top bar: reset, import, and the
 * export flows that used to live in the toolbar row.
 */
export default function ProjectActionsMenu() {
  const store = useStore();
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
      store.import(data);
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
          disabled={store.isBusy}
        >
          <ListItemIcon>
            <SystemUpdateAlt fontSize="small" />
          </ListItemIcon>
          <ListItemText>Import JSON</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem disabled>Export project…</MenuItem>
        <MenuItem
          onClick={() => {
            close();
            store.export("pdf");
          }}
          disabled={store.isBusy}
        >
          <ListItemIcon>
            <PictureAsPdf fontSize="small" />
          </ListItemIcon>
          <ListItemText>Export as PDF</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            close();
            store.export("txt");
          }}
          disabled={store.isBusy}
        >
          <ListItemIcon>
            <MenuBook fontSize="small" />
          </ListItemIcon>
          <ListItemText>Export as TXT</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            close();
            store.export("json");
          }}
          disabled={store.isBusy}
        >
          <ListItemIcon>
            <DataObject fontSize="small" />
          </ListItemIcon>
          <ListItemText>Export as JSON</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem disabled>Export source code…</MenuItem>
        <MenuItem
          onClick={() => {
            close();
            store.exportCode("zip");
          }}
          disabled={store.isBusy || !store.hasGeneratedScaffold}
        >
          <ListItemIcon>
            <FolderZip fontSize="small" />
          </ListItemIcon>
          <ListItemText>.zip</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            close();
            store.exportCode("tar.gz");
          }}
          disabled={store.isBusy || !store.hasGeneratedScaffold}
        >
          <ListItemIcon>
            <FolderZip fontSize="small" />
          </ListItemIcon>
          <ListItemText>.tar.gz</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            close();
            store.exportCode("tar.bz2");
          }}
          disabled={store.isBusy || !store.hasGeneratedScaffold}
        >
          <ListItemIcon>
            <FolderZip fontSize="small" />
          </ListItemIcon>
          <ListItemText>.tar.bz2</ListItemText>
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
