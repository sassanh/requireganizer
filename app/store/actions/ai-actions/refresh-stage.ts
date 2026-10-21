import { toGenerator } from "mobx-state-tree";

import type { CommandStage } from "ai-agent/command";
import { UserFacingError } from "lib/errors";
import { WORKFLOW_STAGE_LABELS, WorkflowStage } from "store/constants";
import { summarizeInputChanges, type InputChange } from "store/stageInputDiff";

import { generator } from "./utilities";

/**
 * The task comment for a refresh, the single place that tells the model
 * what changed and what it must regenerate. The full-list tools accept
 * bare ids for kept items. Every regenerated item returns to draft, kept
 * or changed; items the change did not reach through their references are
 * confirmed separately by impact approval, so the comment never promises
 * that anything keeps its approval.
 */
export function buildRefreshComment(
  stage: WorkflowStage,
  hint?: string,
  changes: readonly InputChange[] = [],
  outdatedCodes: readonly string[] = [],
): string {
  const label = WORKFLOW_STAGE_LABELS[stage];
  const outdated = outdatedCodes.length === 0
    ? ""
    : ` Reconsider each outdated item (${outdatedCodes.join(", ")}) against its changed inputs; keep it word for word when the change does not affect it.`;
  const task =
    `The inputs of ${label} changed since it was generated. ` +
    `Bring ${label} in line with the current inputs: resubmit the complete set, ` +
    `and patch, add, or remove only what the upstream change requires.${outdated}`;
  const listed = summarizeInputChanges(changes).map((line) => `- ${line}`).join("\n");
  const withChanges = listed === "" ? task : `${task} Upstream changes:\n${listed}`;
  return hint != null && hint.trim().length > 0 ? `${withChanges} ${hint.trim()}` : withChanges;
}

export default generator(
  function* (self, step: WorkflowStage, hint?: string) {
    if (step === WorkflowStage.Code) return;
    const label = self.stageLabel(step);
    if (!self.canRefreshStep(step)) {
      throw new UserFacingError(`${label} has nothing outdated to refresh.`);
    }
    const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
    yield* toGenerator(runAgentCommand(self, `refresh ${label}`, {
      kind: "revise",
      stage: step as CommandStage,
      comment: buildRefreshComment(
        step,
        hint,
        self.inputChanges(step),
        self.outdatedItemIds(step).map((id) => self.getCode(id) ?? id),
      ),
    }));
  },
  {
    operation: "refresh the stage",
    targetStep: (step: WorkflowStage, _hint?: string) => step,
  },
);
