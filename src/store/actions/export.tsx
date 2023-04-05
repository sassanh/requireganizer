import { pdf } from "@react-pdf/renderer";
import PDFDocument from "components/PDFDocument";
import { saveAs } from "file-saver";
import { Store } from "store";

const export_ = async (self_: unknown, format: "pdf" | "txt" | "json") => {
  const self = self_ as Store;

  const filename = `specification.${format}`;

  if (format === "pdf") {
    const blob = await pdf(<PDFDocument store={self} />).toBlob();
    saveAs(blob, filename);
  } else if (format === "txt" || format === "json") {
    let content = "";

    if (format === "txt") {
      content = `
Description:
${self.description}

Product Overview:
${self.productOverview}

User Stories:
${self.userStories.map((story) => story.content).join("\n")}

Requirements:
${self.requirements.map((req) => req.content).join("\n")}

Acceptance Criteria:
${self.acceptanceCriteria.map((criteria) => criteria.content).join("\n")}

Test Scenarios:
${self.testScenarios
  .map(
    (testScenario) => `${testScenario.content}
${testScenario.testCases.map((testCase) => testCase.content).join("\n")}
`
  )
  .join("\n")}
      `;
    } else if (format === "json") {
      const data = {
        description: self.description,
        productOverview: self.productOverview,
        userStories: self.userStories,
        requirements: self.requirements,
        acceptanceCriteria: self.acceptanceCriteria,
        testScenarios: self.testScenarios,
      };
      content = JSON.stringify(data, null, 2);
    }

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    saveAs(blob, filename);
  }
};
export default export_;
