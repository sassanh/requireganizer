import {
  DataObject,
  FileDownload,
  FolderZip,
  MenuBook,
  PictureAsPdf,
  SettingsBackupRestore,
  UploadFile,
} from "@mui/icons-material";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from "@mui/material";
import { ChangeEvent, useRef, useState } from "react";

import { parseJson } from "lib/json";

type CodeArchiveFormat = "zip" | "tar.gz" | "tar.bz2";
type ProjectExportFormat = "pdf" | "txt" | "json";

interface ToolbarProps {
  disabled?: boolean;
  exportCodeDisabled?: boolean;
  onExportCode: (format: CodeArchiveFormat) => void;
  onExport: (format: ProjectExportFormat) => void;
  onImport: (data: unknown) => void;
  onReset: () => void;
}

export default function Toolbar({
  disabled = false,
  exportCodeDisabled = true,
  onExportCode,
  onExport,
  onImport,
  onReset,
}: ToolbarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [exportCodeAnchor, setExportCodeAnchor] = useState<HTMLElement | null>(
    null,
  );
  const [exportProjectAnchor, setExportProjectAnchor] =
    useState<HTMLElement | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const handleCodeExport = (format: CodeArchiveFormat) => {
    onExportCode(format);
    setExportCodeAnchor(null);
  };

  const handleProjectExport = (format: ProjectExportFormat) => {
    onExport(format);
    setExportProjectAnchor(null);
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const data = parseJson(await file.text(), "Imported project");
      onImport(data);
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

  const handleReset = () => {
    onReset();
    setResetDialogOpen(false);
  };

  return (
    <Stack sx={{ gap: 1 }}>
      <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
        <Button
          disabled={disabled}
          color="error"
          variant="outlined"
          startIcon={<SettingsBackupRestore />}
          onClick={() => setResetDialogOpen(true)}
        >
          Reset Data
        </Button>
        <Button
          disabled={disabled}
          color="secondary"
          variant="outlined"
          startIcon={<UploadFile />}
          onClick={() => inputRef.current?.click()}
        >
          Import JSON
        </Button>

        <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

        <Button
          disabled={disabled}
          variant="outlined"
          startIcon={<FileDownload />}
          onClick={(event) => setExportProjectAnchor(event.currentTarget)}
        >
          Export Project
        </Button>
        <Menu
          anchorEl={exportProjectAnchor}
          open={exportProjectAnchor !== null}
          onClose={() => setExportProjectAnchor(null)}
        >
          <MenuItem onClick={() => handleProjectExport("pdf")}>
            <ListItemIcon>
              <PictureAsPdf fontSize="small" />
            </ListItemIcon>
            <ListItemText>Export as PDF</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => handleProjectExport("txt")}>
            <ListItemIcon>
              <MenuBook fontSize="small" />
            </ListItemIcon>
            <ListItemText>Export as TXT</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => handleProjectExport("json")}>
            <ListItemIcon>
              <DataObject fontSize="small" />
            </ListItemIcon>
            <ListItemText>Export as JSON</ListItemText>
          </MenuItem>
        </Menu>

        <Button
          disabled={disabled || exportCodeDisabled}
          variant="contained"
          color="primary"
          startIcon={<FolderZip />}
          onClick={(event) => setExportCodeAnchor(event.currentTarget)}
        >
          Export Source Code
        </Button>
        <Menu
          anchorEl={exportCodeAnchor}
          open={exportCodeAnchor !== null}
          onClose={() => setExportCodeAnchor(null)}
        >
          <MenuItem onClick={() => handleCodeExport("zip")}>.zip</MenuItem>
          <MenuItem onClick={() => handleCodeExport("tar.gz")}>
            .tar.gz
          </MenuItem>
          <MenuItem onClick={() => handleCodeExport("tar.bz2")}>
            .tar.bz2
          </MenuItem>
        </Menu>

        <input
          hidden
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleImport}
        />
      </Stack>

      {importError && (
        <Alert severity="error" onClose={() => setImportError(null)}>
          {importError}
        </Alert>
      )}

      <Dialog open={resetDialogOpen} onClose={() => setResetDialogOpen(false)}>
        <DialogTitle>Reset project data?</DialogTitle>
        <DialogContent>
          <Typography>
            This removes the current requirements, tests, configuration, and
            generated code. This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetDialogOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleReset}>
            Reset Project
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
