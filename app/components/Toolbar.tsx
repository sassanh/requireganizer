import { faJs } from "@fortawesome/free-brands-svg-icons";
import {
  faFile,
  faFilePdf,
  faFileText,
} from "@fortawesome/free-solid-svg-icons";
import React, { useState } from "react";

import { Framework, ProgrammingLanguage } from "store";
import {
  AcceptanceCriteria,
  Requirement,
  TestScenario,
  UserStory,
} from "store/models";
import { ProductOverview } from "store/models/ProductOverview";

import { IconButton } from "./controls";
import css from "./Toolbar.module.css";

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
    <div className={css.container}>
      <IconButton disabled={disabled} icon={faFile} onClick={onReset}>
        Reset
      </IconButton>
      <div className={css.vl} />
      <IconButton
        disabled={disabled}
        icon={faJs}
        onClick={() => inputRef?.click()}
      >
        Import JSON
      </IconButton>
      <div className={css.vl} />
      <IconButton
        disabled={disabled}
        icon={faFilePdf}
        onClick={() => onExport("pdf")}
      >
        Export as PDF
      </IconButton>
      <IconButton
        disabled={disabled}
        icon={faFileText}
        onClick={() => onExport("txt")}
      >
        Export as TXT
      </IconButton>
      <IconButton
        disabled={disabled}
        icon={faJs}
        onClick={() => onExport("json")}
      >
        Export as JSON
      </IconButton>
      <input
        hidden
        ref={setInputRef}
        type="file"
        id="import-json"
        accept=".json"
        onChange={handleImport}
      />
    </div>
  );
};

export default Toolbar;
