import React from "react";
import { saveAs } from "file-saver";
import { pdf } from "@react-pdf/renderer";
import ExportOptions from "./ExportOptions";
import PDFDocument from "./PDFDocument";
import { UserStory, Requirement, AcceptanceCriteria } from "../types";

interface ExporterProps {
  userStories: UserStory[];
  requirements: Requirement[];
  acceptanceCriteria: AcceptanceCriteria[];
}

const Exporter: React.FC<ExporterProps> = ({
  userStories,
  requirements,
  acceptanceCriteria,
}) => {
  const handleExport = async (format: "pdf" | "txt" | "json") => {
    const filename = `exported_content.${format}`;

    if (
      userStories == null ||
      requirements == null ||
      acceptanceCriteria == null
    ) {
      return;
    }

    if (format === "pdf") {
      const blob = await pdf(
        <PDFDocument
          userStories={userStories}
          requirements={requirements}
          acceptanceCriteria={acceptanceCriteria}
        />
      ).toBlob();
      saveAs(blob, filename);
    } else if (format === "txt" || format === "json") {
      let content = "";

      if (format === "txt") {
        content = `
User Stories:
${userStories.map((story) => story.content).join("\n")}

Requirements:
${requirements.map((req) => req.content).join("\n")}

Acceptance Criteria:
${acceptanceCriteria.map((criteria) => criteria.content).join("\n")}
      `;
      } else if (format === "json") {
        const data = {
          userStories,
          requirements,
          acceptanceCriteria,
        };
        content = JSON.stringify(data, null, 2);
      }

      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      saveAs(blob, filename);
    }
  };

  return <ExportOptions onExport={handleExport} />;
};

export default Exporter;
