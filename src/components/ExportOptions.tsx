import React from "react";

interface ExportOptionsProps {
  onExport: (format: "pdf" | "txt" | "json") => void;
}

const ExportOptions: React.FunctionComponent<ExportOptionsProps> = ({
  onExport,
}) => {
  return (
    <div>
      Export Options
      <button onClick={() => onExport("pdf")}>Export as PDF</button>
      <button onClick={() => onExport("txt")}>Export as TXT</button>
      <button onClick={() => onExport("json")}>Export as JSON</button>
    </div>
  );
};

export default ExportOptions;
