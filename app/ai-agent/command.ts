import type { Step, StructuralFragment } from "store/constants";

/**
 * "implementation-profile" is an artifact stage inside the Interface Contracts
 * step, so commands address it directly even though it has no dedicated Step.
 */
export type CommandStage = Exclude<Step, Step.Code> | "implementation-profile";

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
