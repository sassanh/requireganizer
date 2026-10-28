import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

import { CANONICAL_WORKFLOW } from "ai-harness/workflow";
import { WORKFLOW_STAGE_LABELS, WorkflowStage } from "store/constants";
import type { FlatStore } from "store/store";
import { authorLabel, waitsForPerson } from "store/threads";

function textResult(text: string): { content: [{ type: "text"; text: string }]; details: Record<string, never> } {
  return { content: [{ type: "text", text }], details: {} };
}

/** The reviewer model's rejections standing on a stage's unapproved items, each with its reason. */
export function reviewerRejections(store: FlatStore, step: WorkflowStage): { unitId: string; reason: string }[] {
  return store.stageUnits(step).flatMap((unit) => {
    if (unit.approved || unit.outdated) return [];
    const verdict = store.currentVerdictOf(unit.id);
    return verdict?.verdict === "reject" ? [{ unitId: unit.id, reason: verdict.reason }] : [];
  });
}

/**
 * Read-only tools that let the model inspect the live project state instead
 * of receiving artifact content embedded in prompts.
 */
export function buildReadTools(
  store: FlatStore,
  /** The module `store` is, named to a caller that works on whichever module the person has open. */
  options: { moduleName?: string } = {},
): AgentTool[] {
  const { moduleName } = options;
  const validStages = CANONICAL_WORKFLOW.filter((step) => step !== WorkflowStage.Code);
  const stageNamed = (stage: string): WorkflowStage => {
    const step = validStages.find((candidate) => candidate === stage);
    if (step == null) {
      throw new Error(`Unknown stage ${stage}. Valid stages: ${validStages.join(", ")}.`);
    }
    return step;
  };

  const workflowState: AgentTool = {
    name: "get_workflow_state",
    label: "Get workflow state",
    description:
      `${moduleName == null ? "" : "Get the module the person has open in Requireganizer, which every tool reads and submits to, and its workflow state. "}Get the frontier (the first stage that is not complete; only it and earlier stages can change) and each stage's status: pending, completed, outdated, needs-approval, waiting (holds work, read-only until the frontier reaches it), or locked. Each stage lists its outdated items, which must be regenerated, its unapproved review units, and the reviewer model's rejections of them. Inputs that changed since the stage acknowledged them are listed by id; read them with get_input_changes. Each stage lists its open threads: the person's change requests on its units, with every reply; changeRequestsAnsweredBy names who answers them.`,
    parameters: Type.Object({}),
    execute: async () => {
      const stages = validStages.map((step) => {
        const units = store.stageUnits(step);
        return {
          stage: step,
          label: WORKFLOW_STAGE_LABELS[step],
          status: store.getStepStatus(step),
          hasArtifacts: store.hasStepArtifacts(step),
          outdatedItemIds: units.filter(({ outdated }) => outdated).map(({ id }) => id),
          unapprovedUnitIds: units
            .filter(({ approved, outdated }) => !approved && !outdated)
            .map(({ id }) => id),
          reviewerRejections: reviewerRejections(store, step),
          changedInputIds: store.changedInputIds(step),
          mechanicalIssues: store.mechanicalIssuesForStage(step).map(({ itemId, message }) => ({
            itemId,
            message,
          })),
          openThreads: store.openThreads(step).map((thread) => ({
            threadId: thread.id,
            unitId: thread.unitId,
            waitingFor: waitsForPerson(thread) ? "person" : store.threadAnswerer,
            messages: thread.messages.map(({ author, text, withSubmission }) => ({
              from: author.kind === "person" ? "person" : authorLabel(author),
              text,
              ...(withSubmission ? { withSubmission } : {}),
            })),
          })),
        };
      });
      return textResult(JSON.stringify({
        ...(moduleName == null ? {} : { module: moduleName }),
        frontier: store.frontier,
        changeRequestsAnsweredBy: store.threadAnswerer,
        stages,
      }));
    },
  };

  const stageArtifacts: AgentTool = {
    name: "get_stage_artifacts",
    label: "Get stage artifacts",
    description:
      "Get the full JSON serialization of the current artifacts up to and including one workflow stage. Stages use kebab-case names matching the workflow (e.g. \"product-overview\", \"boundary-design\"). reviewStatus gives each unit's current status: approved, draft, outdated, or removal-proposed. A unit's signature records its last approval and does not say whether it still holds.",
    parameters: Type.Object({
      stage: Type.String({ description: "The workflow stage to read." }),
    }),
    execute: async (_toolCallId, params) => {
      const { stage } = params as { stage: string };
      const step = stageNamed(stage);
      return textResult(JSON.stringify({ ...store.data(step), reviewStatus: store.reviewStatuses(step) }));
    },
  };

  const inputChanges: AgentTool = {
    name: "get_input_changes",
    label: "Get input changes",
    description:
      "Get every input of one stage that changed since the stage acknowledged its inputs: each entry has the input's id and its content before and after (null when it did not exist).",
    parameters: Type.Object({
      stage: Type.String({ description: "The workflow stage whose changed inputs to read." }),
    }),
    execute: async (_toolCallId, params) => {
      const { stage } = params as { stage: string };
      return textResult(JSON.stringify(store.inputChanges(stageNamed(stage))));
    },
  };

  const scaffoldFiles: AgentTool = {
    name: "get_scaffold_files",
    label: "Get scaffold files",
    description:
      "List generated scaffold files with their paths and contents. Pass a path to read one file; omit the path to list all files.",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "An exact scaffold file path." })),
    }),
    execute: async (_toolCallId, params) => {
      const { path } = params as { path?: string };
      if (path != null) {
        const file = store.scaffoldFiles.find(({ path: candidate }) => candidate === path);
        if (file == null) {
          throw new Error(`No scaffold file at ${path}.`);
        }
        return textResult(JSON.stringify(file));
      }
      return textResult(JSON.stringify(
        store.scaffoldFiles.map(({ path: filePath, content }) => ({ path: filePath, content })),
      ));
    },
  };

  return [workflowState, stageArtifacts, inputChanges, scaffoldFiles];
}
