import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

import { CANONICAL_WORKFLOW } from "ai-harness/workflow";
import { WORKFLOW_STAGE_LABELS, WorkflowStage } from "store/constants";
import type { FlatStore } from "store/store";

function textResult(text: string): { content: [{ type: "text"; text: string }]; details: Record<string, never> } {
  return { content: [{ type: "text", text }], details: {} };
}

/**
 * Read-only tools that let the model inspect the live project state instead
 * of receiving artifact content embedded in prompts.
 */
export function buildReadTools(store: FlatStore): AgentTool[] {
  const workflowState: AgentTool = {
    name: "get_workflow_state",
    label: "Get workflow state",
    description:
      "Get the project description plus the status of every workflow stage (pending, completed, outdated) and which artifacts exist.",
    parameters: Type.Object({}),
    execute: async () => {
      const stages = CANONICAL_WORKFLOW.filter((step) => step !== WorkflowStage.Code)
        .map((step) => ({
          stage: WORKFLOW_STAGE_LABELS[step],
          status: store.getStepStatus(step),
          hasArtifacts: store.hasStepArtifacts(step),
        }));
      return textResult(JSON.stringify({
        description: store.description,
        stages,
      }));
    },
  };

  const validStages = CANONICAL_WORKFLOW.filter((step) => step !== WorkflowStage.Code);

  const stageArtifacts: AgentTool = {
    name: "get_stage_artifacts",
    label: "Get stage artifacts",
    description:
      "Get the full JSON serialization of one workflow stage's artifacts. Stages use kebab-case names matching the workflow (e.g. \"product-overview\", \"boundary-design\").",
    parameters: Type.Object({
      stage: Type.String({ description: "The workflow stage to read." }),
    }),
    execute: async (_toolCallId, params) => {
      const { stage } = params as { stage: string };
      const step = validStages.find((candidate) => candidate === stage);
      if (step == null) {
        throw new Error(
          `Unknown stage ${stage}. Valid stages: ${validStages.join(", ")}.`,
        );
      }
      return textResult(store.json(step));
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

  return [workflowState, stageArtifacts, scaffoldFiles];
}
