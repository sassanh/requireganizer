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
      "Get the status of every workflow stage (pending, completed, outdated, locked) and which artifacts exist. Each generated stage also reports the input hash of the inputs it was built from, never the stage itself. Pass a stage with its own hash to get_stage_artifacts to re-read those recorded inputs.",
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
      "Get the full JSON serialization of one workflow stage's artifacts. Stages use kebab-case names matching the workflow (e.g. \"product-overview\", \"boundary-design\"). Omit the hash for the current artifacts. Pass a stage with its own recorded input hash from get_workflow_state to re-read the inputs it was built from. To read a stage as recorded, pass a later stage's hash with that stage's name.",
    parameters: Type.Object({
      stage: Type.String({ description: "The workflow stage to read." }),
      hash: Type.Optional(Type.String({ description: "That stage's own recorded input hash from get_workflow_state." })),
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
      if (
        snapshot == null ||
        typeof snapshot !== "object" ||
        Array.isArray(snapshot)
      ) {
        throw new Error(
          `Input version "${hash}" was recorded before readable versions existed and holds no content. Regenerate the stage that recorded it to create a readable version.`,
        );
      }
      const recordedSections = snapshot as Record<string, unknown>;
      const envelope: Record<string, unknown> = {
        schemaVersion: PROJECT_SCHEMA_VERSION,
      };
      // A stage's own hash names the inputs it was built from, so pairing
      // a stage with its own hash returns that full recorded snapshot.
      const recordedByStep = [...store.stageInputFingerprints.entries()].some(
        ([recordedStep, recordedHash]) => recordedStep === step && recordedHash === hash,
      );
      if (recordedByStep) {
        for (const key of INPUT_KEYS_IN_ORDER) {
          if (key in recordedSections) envelope[key] = recordedSections[key];
        }
        return textResult(JSON.stringify(envelope));
      }
      const endpoint = INPUT_KEY_BY_STAGE[step];
      // Otherwise the hash selects a snapshot and the stage selects how
      // much of it to return: the schema marker plus every snapshot
      // section up to the stage's own, exactly the shape a live read
      // returns. A snapshot taken before the stage existed holds none of
      // it, which is a predated read rather than a missing version.
      if (endpoint == null) {
        for (const key of INPUT_KEYS_IN_ORDER) {
          if (key in recordedSections) envelope[key] = recordedSections[key];
        }
        return textResult(JSON.stringify(envelope));
      }
      for (const key of INPUT_KEYS_IN_ORDER) {
        if (key in recordedSections) envelope[key] = recordedSections[key];
        if (key === endpoint) break;
      }
      if (!(endpoint in envelope)) {
        throw new Error(
          `Input version "${hash}" holds no recorded ${WORKFLOW_STAGE_LABELS[step]}. It predates that stage. To read a stage's recorded inputs, pass that stage with its own input hash from get_workflow_state.`,
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
