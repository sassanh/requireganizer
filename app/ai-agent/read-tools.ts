import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

import { CANONICAL_WORKFLOW } from "ai-harness/workflow";
import { PROJECT_SCHEMA_VERSION } from "lib/projectSchema";
import { WORKFLOW_STAGE_LABELS, WorkflowStage } from "store/constants";
import type { FlatStore } from "store/store";
import { tryResolveArtifact } from "store/timeline/serialize";

function textResult(text: string): { content: [{ type: "text"; text: string }]; details: Record<string, never> } {
  return { content: [{ type: "text", text }], details: {} };
}

/**
 * Which input snapshot key holds a stage's artifacts. A stage appears in
 * the snapshots of the stages built from it, never in its own: a stage's
 * own hash versions its inputs, not itself. Stages that no fingerprinted
 * stage consumes have no recorded versions.
 */
const INPUT_KEY_BY_STAGE: Partial<Record<WorkflowStage, string>> = {
  [WorkflowStage.ProductOverview]: "productOverview",
  [WorkflowStage.UserStories]: "userStories",
  [WorkflowStage.Requirements]: "requirements",
  [WorkflowStage.AcceptanceCriteria]: "acceptanceCriteria",
  [WorkflowStage.BoundaryDesign]: "boundaryDesign",
  [WorkflowStage.InterfaceContracts]: "contractSuite",
  [WorkflowStage.TestScenarios]: "testScenarios",
  [WorkflowStage.TestCases]: "testScenarios",
};

/** Snapshot section order, matching the envelope live reads return. */
const INPUT_KEYS_IN_ORDER = [
  "productOverview",
  "userStories",
  "requirements",
  "acceptanceCriteria",
  "boundaryDesign",
  "implementationProfile",
  "contractSuite",
  "testScenarios",
  "projectSetup",
];

/**
 * Read-only tools that let the model inspect the live project state instead
 * of receiving artifact content embedded in prompts.
 */
export function buildReadTools(store: FlatStore): AgentTool[] {
  const workflowState: AgentTool = {
    name: "get_workflow_state",
    label: "Get workflow state",
    description:
      "Get the status of every workflow stage (pending, completed, outdated, locked) and which artifacts exist. Each generated stage also reports the input hash it was built from; pass that hash to get_stage_artifacts to read the recorded version.",
    parameters: Type.Object({}),
    execute: async () => {
      const stages = CANONICAL_WORKFLOW.filter((step) => step !== WorkflowStage.Code)
        .map((step) => ({
          stage: WORKFLOW_STAGE_LABELS[step],
          status: store.getStepStatus(step),
          hasArtifacts: store.hasStepArtifacts(step),
          approved: store.stageIsApproved(step),
          inputHash: store.stageInputFingerprints.get(step) ?? null,
          mechanicalIssues: store.mechanicalIssuesForStage(step).map(({ itemId, message }) => ({
            itemId,
            message,
          })),
        }));
      return textResult(JSON.stringify({
        stages,
      }));
    },
  };

  const validStages = CANONICAL_WORKFLOW.filter((step) => step !== WorkflowStage.Code);

  const stageArtifacts: AgentTool = {
    name: "get_stage_artifacts",
    label: "Get stage artifacts",
    description:
      "Get the full JSON serialization of one workflow stage's artifacts. Stages use kebab-case names matching the workflow (e.g. \"product-overview\", \"boundary-design\"). Omit the hash for the current artifacts; pass a stage's recorded input hash from get_workflow_state to read the version that hash names.",
    parameters: Type.Object({
      stage: Type.String({ description: "The workflow stage to read." }),
      hash: Type.Optional(Type.String({ description: "A recorded input hash from get_workflow_state." })),
    }),
    execute: async (_toolCallId, params) => {
      const { stage, hash } = params as { stage: string; hash?: string };
      const step = validStages.find((candidate) => candidate === stage);
      if (step == null) {
        throw new Error(
          `Unknown stage ${stage}. Valid stages: ${validStages.join(", ")}.`,
        );
      }
      if (hash == null) return textResult(store.json(step));
      const recorded = [...store.stageInputFingerprints.values()];
      if (!recorded.includes(hash)) {
        throw new Error(
          `Unknown input version "${hash}". Use an input hash from get_workflow_state.`,
        );
      }
      const snapshot = tryResolveArtifact(hash);
      const endpoint = INPUT_KEY_BY_STAGE[step];
      // The version is the stage's envelope as recorded: the schema marker
      // plus every snapshot section up to the stage's own, exactly the
      // shape a live read returns.
      const envelope: Record<string, unknown> = {
        schemaVersion: PROJECT_SCHEMA_VERSION,
      };
      if (
        endpoint != null &&
        snapshot != null &&
        typeof snapshot === "object" &&
        !Array.isArray(snapshot)
      ) {
        const recordedSections = snapshot as Record<string, unknown>;
        for (const key of INPUT_KEYS_IN_ORDER) {
          if (key in recordedSections) envelope[key] = recordedSections[key];
          if (key === endpoint) break;
        }
      }
      if (endpoint == null || !(endpoint in envelope)) {
        throw new Error(
          `Input version "${hash}" holds no recorded ${WORKFLOW_STAGE_LABELS[step]}.`,
        );
      }
      return textResult(JSON.stringify(envelope));
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
