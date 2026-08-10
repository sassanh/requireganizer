import {
  DataObject,
  FolderZip,
  MenuBook,
  PictureAsPdf,
  SettingsBackupRestore,
  UploadFile,
  FileDownload,
} from "@mui/icons-material";
import {
  Button,
  Divider,
  Menu,
  MenuItem,
  Stack,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import React, { useState } from "react";
import { Framework, ProgrammingLanguage } from "store";
import {
  AcceptanceCriteria,
  Requirement,
  TestScenario,
  UserStory,
} from "store/models";
import { ProductOverview } from "store/models/ProductOverview";

interface ToolbarProps {
  disabled?: boolean;
  exportCodeDisabled?: boolean;
  onExportCode: (format: "zip" | "tar.gz" | "tar.bz2") => void;
  onExport: (format: "pdf" | "txt" | "json") => void;
  onImport: (data: {
    programmingLanguage: ProgrammingLanguage;
    framework: Framework;
    description: string;
    productOverview: ProductOverview;
    userStories: UserStory[];
    requirements: Requirement[];
    acceptanceCriteria: AcceptanceCriteria[];
    testScenarios: TestScenario[];
  }) => void;
  onReset: () => void;
}

const Toolbar: React.FunctionComponent<ToolbarProps> = ({
  disabled = false,
  exportCodeDisabled = true,
  onExportCode,
  onExport,
  onImport,
  onReset,
}) => {
  const [inputRef, setInputRef] = useState<HTMLInputElement | null>(null);
  const [exportCodeAnchorEl, setExportCodeAnchorEl] =
    useState<null | HTMLElement>(null);
  const [exportProjectAnchorEl, setExportProjectAnchorEl] =
    useState<null | HTMLElement>(null);

  const handleExportCodeClick = (
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    setExportCodeAnchorEl(event.currentTarget);
  };
  const handleExportCodeClose = () => {
    setExportCodeAnchorEl(null);
  };
  const handleExportCodeFormat = (format: "zip" | "tar.gz" | "tar.bz2") => {
    onExportCode(format);
    handleExportCodeClose();
  };

  const handleExportProjectClick = (
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    setExportProjectAnchorEl(event.currentTarget);
  };
  const handleExportProjectClose = () => {
    setExportProjectAnchorEl(null);
  };
  const handleExportProjectFormat = (format: "pdf" | "txt" | "json") => {
    onExport(format);
    handleExportProjectClose();
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        onImport(data);
      } catch (error) {
        console.error("Error parsing JSON file:", error);
      }
    };
    reader.readAsText(file);

    if (inputRef != null) {
      inputRef.value = "";
    }
  };

  return (
    <Stack direction="row" gap={1} flexWrap="wrap">
      {/* --- Import & Reset Group --- */}
      <Button
        disabled={disabled}
        color="error"
        variant="outlined"
        startIcon={<SettingsBackupRestore />}
        onClick={onReset}
      >
        Reset Data
      </Button>
      <Button
        disabled={disabled}
        color="secondary"
        variant="outlined"
        startIcon={<UploadFile />}
        onClick={() => inputRef?.click()}
      >
        Import JSON
      </Button>

      <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

      {/* --- Export Project Data Group --- */}
      <Button
        disabled={disabled}
        variant="outlined"
        startIcon={<FileDownload />}
        onClick={handleExportProjectClick}
      >
        Export Project
      </Button>
      <Menu
        anchorEl={exportProjectAnchorEl}
        open={Boolean(exportProjectAnchorEl)}
        onClose={handleExportProjectClose}
      >
        <MenuItem onClick={() => handleExportProjectFormat("pdf")}>
          <ListItemIcon>
            <PictureAsPdf fontSize="small" />
          </ListItemIcon>
          <ListItemText>Export as PDF</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleExportProjectFormat("txt")}>
          <ListItemIcon>
            <MenuBook fontSize="small" />
          </ListItemIcon>
          <ListItemText>Export as TXT</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleExportProjectFormat("json")}>
          <ListItemIcon>
            <DataObject fontSize="small" />
          </ListItemIcon>
          <ListItemText>Export as JSON</ListItemText>
        </MenuItem>
      </Menu>

      {/* --- Export Generated Code Group --- */}
      <Button
        disabled={disabled || exportCodeDisabled}
        variant="contained"
        color="primary"
        startIcon={<FolderZip />}
        onClick={handleExportCodeClick}
      >
        Export Source Code
      </Button>
      <Menu
        anchorEl={exportCodeAnchorEl}
        open={Boolean(exportCodeAnchorEl)}
        onClose={handleExportCodeClose}
      >
        <MenuItem onClick={() => handleExportCodeFormat("zip")}>.zip</MenuItem>
        <MenuItem onClick={() => handleExportCodeFormat("tar.gz")}>
          .tar.gz
        </MenuItem>
        <MenuItem onClick={() => handleExportCodeFormat("tar.bz2")}>
          .tar.bz2
        </MenuItem>
      </Menu>

      <input
        hidden
        ref={setInputRef}
        type="file"
        id="import-json"
        accept=".json"
        onChange={handleImport}
      />
    </Stack>
  );
};

export default Toolbar;
