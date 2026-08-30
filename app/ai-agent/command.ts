import type { WorkflowStage, StructuralFragment } from "store/constants";
import { WORKFLOW_STAGE_LABELS } from "store/constants";

/**
 * "implementation-profile" is an artifact stage inside the Interface Contracts
 * step, so commands address it directly even though it has no dedicated WorkflowStage.
 */
export type CommandStage = Exclude<WorkflowStage, WorkflowStage.Code> | "implementation-profile";

export type RevisionTarget = {
  kind: "interface" | "subject" | "verification";
  id: string;
};

export type AiCommand =
  | { kind: "generate"; stage: CommandStage; scenarioId?: string }
  | { kind: "revise"; stage: CommandStage; comment?: string; target?: RevisionTarget; scenarioId?: string }
  | { kind: "comment"; fragment: StructuralFragment; id: string; comment: string }
  | { kind: "test-code"; scenarioId: string; testCaseId: string; comment?: string };

/**
 * Commands are rendered as single-line JSON so the conversation transcript
 * stays compact and machine-parseable for the model.
 */
export function renderCommand(command: AiCommand): string {
  return JSON.stringify(command);
}

function stageLabel(stage: CommandStage): string {
  if (stage === "implementation-profile") return "implementation profile";
  return WORKFLOW_STAGE_LABELS[stage];
}

/**
 * A short human-readable sentence describing what the command asks for,
 * used when collapsing command bubbles in the conversation view.
 */
export function describeCommand(command: AiCommand): string {
  switch (command.kind) {
    case "generate": {
      const scope = command.scenarioId != null ? ` for scenario ${command.scenarioId}` : "";
      return `Generate ${stageLabel(command.stage)}${scope}`;
    }
    case "revise": {
      let text = `Revise ${stageLabel(command.stage)}`;
      if (command.target != null) text += ` (${command.target.kind} ${command.target.id})`;
      if (command.comment != null && command.comment.length > 0) text += ` — ${command.comment}`;
      return text;
    }
    case "comment":
      return `Apply requested change to ${command.id}: ${command.comment}`;
    case "test-code":
      return `Generate automated test code for ${command.testCaseId}${command.comment ? ` — ${command.comment}` : ""}`;
  }
}

const COMMAND_KINDS = ["generate", "revise", "comment", "test-code"] as const;

/**
 * Recognize a transcript entry produced by renderCommand. Returns null for
 * anything else so free-form composer messages stay plain prose.
 */
export function parseCommandMessage(text: string): AiCommand | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed == null) return null;
  const candidate = parsed as { kind?: unknown };
  if (
    typeof candidate.kind !== "string" ||
    !COMMAND_KINDS.includes(candidate.kind as (typeof COMMAND_KINDS)[number])
  ) {
    return null;
  }
  return parsed as AiCommand;
}
