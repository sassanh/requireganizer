import { toGenerator } from "mobx-state-tree";

import type { CommandStage } from "ai-agent/command";
import { UserFacingError } from "lib/errors";
import { Status, WORKFLOW_STAGE_LABELS, WorkflowStage } from "store/constants";

import { generator } from "./utilities";

/**
 * The task comment for a stale-stage refresh, the single place that tells
 * the model what changed and how to touch it. The full-list tools already
 * accept bare ids for untouched items; the comment points at the upstream
 * change and orders minimal edits, so unaffected items resubmit
 * byte-identical and keep their approvals. The change list comes from the
 * store's recorded inputs; an empty list keeps the generic wording. Both
 * input versions travel in the comment so the model never fetches them.
 */
export function buildRefreshComment(
  stage: WorkflowStage,
  hint?: string,
  changes: string[] = [],
  versions: { previous: unknown; current: unknown } | null = null,
): string {
  const label = WORKFLOW_STAGE_LABELS[stage];
  const task =
    `The inputs of ${label} changed since it was generated. ` +
    `Bring ${label} in line with the current inputs: resubmit the complete set, ` +
    `keeping every unaffected item byte-identical, and patch, add, or remove ` +
    `only what the upstream change requires.`;
  const listed = changes
    .map((change) => change.trim())
    .filter((change) => change.length > 0)
    .map((change) => `- ${change}`)
    .join("\n");
  const withChanges = listed === "" ? task : `${task} Upstream changes:\n${listed}`;
  const withVersions = versions == null
    ? withChanges
    : `${withChanges}\nPrevious inputs: ${JSON.stringify(versions.previous)}\nCurrent inputs: ${JSON.stringify(versions.current)}`;
  return hint != null && hint.trim().length > 0 ? `${withVersions} ${hint.trim()}` : withVersions;
}

export default generator(
  function* (self, step: WorkflowStage, hint?: string) {
    if (step === WorkflowStage.Code) return;
    const label = WORKFLOW_STAGE_LABELS[step];
    if (self.getStepStatus(step) === Status.Pending) {
      throw new UserFacingError(
        `${label} has not been generated yet; generate it first.`,
      );
    }
    if (self.stageIsLocked(step)) {
      const blocker = self.firstPendingPredecessor(step) ?? step;
      throw new UserFacingError(
        `Complete ${WORKFLOW_STAGE_LABELS[blocker]} before refreshing ${label}.`,
      );
    }
    const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
    yield* toGenerator(runAgentCommand(self, `refresh ${label}`, {
      kind: "revise",
      stage: step as CommandStage,
      comment: buildRefreshComment(
        step,
        hint,
        self.stageInputChanges(step),
        self.stageInputVersions(step),
      ),
    }));
  },
  {
    operation: "refresh the stage",
    targetStep: (step: WorkflowStage, _hint?: string) => step,
  },
);
