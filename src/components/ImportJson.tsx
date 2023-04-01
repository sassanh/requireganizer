import React, { ChangeEvent } from "react";
import { AcceptanceCriteria, Requirement, UserStory } from "../types";

interface ImportJsonProps {
  onImport: (data: {
    userStories: UserStory[];
    requirements: Requirement[];
    acceptanceCriteria: AcceptanceCriteria[];
  }) => void;
}

const ImportJson: React.FunctionComponent<ImportJsonProps> = ({ onImport }) => {
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
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
  };

  return (
    <div>
      <label htmlFor="import-json">Import JSON:</label>
      <input
        type="file"
        id="import-json"
        accept=".json"
        onChange={handleFileChange}
      />
    </div>
  );
};

export default ImportJson;
