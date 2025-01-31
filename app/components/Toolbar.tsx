import {
  DataObject,
  InsertDriveFileOutlined,
  MenuBook,
  PictureAsPdf,
} from "@mui/icons-material";
import { Button, Divider, Stack } from "@mui/material";
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
  onExport,
  onImport,
  onReset,
}) => {
  const [inputRef, setInputRef] = useState<HTMLInputElement | null>(null);

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
    <Stack direction="row" gap={1}>
      <Button
        disabled={disabled}
        variant="outlined"
        endIcon={<InsertDriveFileOutlined />}
        onClick={onReset}
      >
        Reset
      </Button>
      <Divider orientation="vertical" flexItem />
      <Button
        disabled={disabled}
        variant="outlined"
        endIcon={<DataObject />}
        onClick={() => inputRef?.click()}
      >
        Import JSON
      </Button>
      <Divider orientation="vertical" flexItem />
      <Button
        disabled={disabled}
        variant="outlined"
        endIcon={<PictureAsPdf />}
        onClick={() => onExport("pdf")}
      >
        Export as PDF
      </Button>
      <Button
        disabled={disabled}
        variant="outlined"
        endIcon={<MenuBook />}
        onClick={() => onExport("txt")}
      >
        Export as TXT
      </Button>
      <Button
        disabled={disabled}
        variant="outlined"
        endIcon={<DataObject />}
        onClick={() => onExport("json")}
      >
        Export as JSON
      </Button>
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
