"use client";

import {
  BugReport,
  DataObject,
  FileDownload,
  FileUpload,
  FolderZip,
  Menu as MenuIcon,
  MenuBook,
  PictureAsPdf,
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
import { saveAs } from "file-saver";
import { useRef, useState, ChangeEvent } from "react";

import { switchModuleShortcut } from "actions/actions";
import { shortcutText } from "actions/shortcutText";
import { parseJson } from "lib/json";
import { useProject } from "provider";
import { useStore } from "store";
import { getTimelineSnapshot } from "store/timeline/controller";

import PersistentAlert from "./PersistentAlert";

/**
 * The project-actions menu anchored in the top bar: modules, import, and
 * the export flows that used to live in the toolbar row.
 */
export default function ProjectActionsMenu({
  onShowModules,
}: {
  onShowModules: () => void;
}) {
  const store = useStore();
  const {
    modulesEnabled,
    codeExportAvailable,
    importProjectFile,
    exportProject,
    exportCodeArchive,
  } = useProject();
  const inputRef = useRef<HTMLInputElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [debugAnchor, setDebugAnchor] = useState<HTMLElement | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const close = () => {
    setAnchor(null);
    setDebugAnchor(null);
  };

  const exportConversation = () => {
    saveAs(
      new Blob([JSON.stringify(store.conversation ?? [], null, 2)], {
        type: "application/json;charset=utf-8",
      }),
      `requireganizer-conversation-${Date.now()}.json`,
    );
  };

  const exportTimeline = () => {
    const snapshot = getTimelineSnapshot();
    if (snapshot == null) return;
    saveAs(
      new Blob([JSON.stringify(snapshot, null, 2)], {
        type: "application/json;charset=utf-8",
      }),
      `requireganizer-timeline-${Date.now()}.json`,
    );
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const data = parseJson(await file.text(), "Imported project");
      importProjectFile(data);
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
            void exportProject("pdf");
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
            void exportProject("txt");
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
            void exportProject("json");
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
            exportCodeArchive("zip");
          }}
          disabled={store.isBusy || !codeExportAvailable}
        >
          <ListItemIcon>
            <FolderZip fontSize="small" />
          </ListItemIcon>
          <ListItemText>.zip</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            close();
            exportCodeArchive("tar.gz");
          }}
          disabled={store.isBusy || !codeExportAvailable}
        >
          <ListItemIcon>
            <FolderZip fontSize="small" />
          </ListItemIcon>
          <ListItemText>.tar.gz</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            close();
            exportCodeArchive("tar.bz2");
          }}
          disabled={store.isBusy || !codeExportAvailable}
        >
          <ListItemIcon>
            <FolderZip fontSize="small" />
          </ListItemIcon>
          <ListItemText>.tar.bz2</ListItemText>
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
                sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}
              >
                <Box component="span">
                  {modulesEnabled ? "Modules" : "Enable modules"}
                </Box>
                <Box
                  component="span"
                  sx={{ color: "text.secondary", whiteSpace: "nowrap" }}
                >
                  {shortcutText(switchModuleShortcut)}
                </Box>
              </Box>
            }
          />
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={(event) => setDebugAnchor(event.currentTarget)}
        >
          <ListItemIcon>
            <BugReport fontSize="small" />
          </ListItemIcon>
          <ListItemText>Debug</ListItemText>
        </MenuItem>
      </Menu>
      <Menu
        anchorEl={debugAnchor}
        open={debugAnchor !== null}
        onClose={() => setDebugAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
      >
        <MenuItem
          onClick={() => {
            close();
            exportConversation();
          }}
          disabled={(store.conversation?.length ?? 0) === 0}
        >
          <ListItemIcon>
            <DataObject fontSize="small" />
          </ListItemIcon>
          <ListItemText>Export conversation JSON</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            close();
            exportTimeline();
          }}
          disabled={getTimelineSnapshot() == null}
        >
          <ListItemIcon>
            <FileDownload fontSize="small" />
          </ListItemIcon>
          <ListItemText>Export timeline &amp; steps JSON</ListItemText>
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
