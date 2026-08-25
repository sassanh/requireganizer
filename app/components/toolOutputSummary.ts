/**
 * The conversation log is the human-facing record of tool activity, while
 * tool results themselves are the model's data — read tools return full
 * artifact serializations, submission tools return outcome confirmations.
 * This translates a tool result into the text the log expands to.
 *
 * Results that are already human-readable (confirmations, error messages)
 * pass through unchanged; structured payloads are summarized by their
 * recognized shape.
 */
export function describeToolOutput(
  toolName: string,
  text: string,
  isError = false,
): string {
  // Chip labels read as labels — no sentence punctuation.
  return summarizeToolOutput(toolName, text, isError).replace(/\.$/, "");
}

function summarizeToolOutput(
  toolName: string,
  text: string,
  isError: boolean,
): string {
  if (isError) return text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (parsed == null || typeof parsed !== "object") return text;

  switch (toolName) {
    case "get_stage_artifacts":
      return describeStageArtifacts(parsed as Record<string, unknown>, text);
    case "get_workflow_state":
      return "Read the workflow state.";
    case "get_scaffold_files":
      return describeScaffoldFiles(parsed);
    default:
      return describeUnknownPayload(text);
  }
}

const STAGE_SECTION_LABELS: Record<string, string> = {
  productOverview: "product overview",
  userStories: "user stories",
  requirements: "requirements",
  acceptanceCriteria: "acceptance criteria",
  boundaryDesign: "boundary design",
  implementationProfile: "implementation profile",
  contractSuite: "formal contracts",
  testScenarios: "test scenarios",
  projectSetup: "project setup",
};

function describeStageArtifacts(
  payload: Record<string, unknown>,
  text: string,
): string {
  const sections = Object.keys(STAGE_SECTION_LABELS).filter(
    (key) => key in payload,
  );
  if (sections.length === 0) return describeUnknownPayload(text);

  const labels = sections.map((key) => STAGE_SECTION_LABELS[key]);
  const subject =
    labels.length === 1
      ? `the ${labels[0]} artifacts`
      : `the ${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]} artifacts`;
  return `Read ${subject}.`;
}

function describeScaffoldFiles(parsed: unknown): string {
  if (Array.isArray(parsed)) {
    return `Read ${parsed.length} scaffold file${parsed.length === 1 ? "" : "s"}.`;
  }
  const path = (parsed as { path?: unknown }).path;
  return typeof path === "string"
    ? `Read the scaffold file ${path}.`
    : "Read the scaffold files.";
}

function describeUnknownPayload(text: string): string {
  const kilobytes = text.length / 1024;
  return kilobytes >= 1
    ? `Read structured data (${kilobytes.toFixed(1)} KB of JSON).`
    : "Read structured data (JSON).";
}
