import React, { ChangeEvent, useState } from "react";

import {
  AcceptanceCriteria,
  Requirement,
  TestScenario,
  UserStory,
} from "../store/models";

interface ImportJsonProps {
  onImport: (data: {
    productOverview: string;
    userStories: UserStory[];
    requirements: Requirement[];
    acceptanceCriteria: AcceptanceCriteria[];
    testScenarios: TestScenario[];
  }) => void;
}

const ImportJson: React.FunctionComponent<ImportJsonProps> = ({ onImport }) => {
  const [importInputKey, setImportInputKey] = useState<number>(0);

  const handleImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        onImport(data);
      } catch (error) {
        console.error("Error parsing JSON file:", error);
      }
    };
    reader.readAsText(file);
    setImportInputKey(importInputKey + 1);
  };

  return (
    <div>
      <label htmlFor="import-json">Import JSON:</label>
      <input
        type="file"
        id="import-json"
        accept=".json"
        onChange={handleImport}
        key={importInputKey}
      />
    </div>
  );
};

export default ImportJson;
