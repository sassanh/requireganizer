import { toGenerator } from "mobx-state-tree";

import { type CommandStage, workflowStageOf } from "ai-agent/command";
import { UserFacingError } from "lib/errors";

import { generator } from "./utilities";

/**
 * Apply a proposal an outside agent submitted through a stage's submission
 * tool: the same tool, validation, upstream gate and review the built-in
 * agent's proposals go through. A proposal the tool rejects fails the flow
 * with the tool's message, so the agent can correct it. While a change
 * waits for the person's confirmation, nothing is applied: confirming it
 * would replace the store with the state it was proposed on.
 */
export default generator(
  function* submitAgentProposal(
    self,
    stage: CommandStage,
    toolName: string,
    args: Record<string, unknown>,
  ) {
    const pending = self.pendingImpactChange;
    if (pending != null) {
      throw new UserFacingError(
        `A proposal that reopens ${pending.sourceLabel} waits for the person to confirm or cancel it in Requireganizer. Submit again after that.`,
      );
    }
    const { buildStageSubmissionTools } = yield* toGenerator(import("ai-agent/result-tools"));
    const submission = buildStageSubmissionTools(self).find(
      (candidate) => candidate.stage === stage && candidate.tool.name === toolName,
    );
    if (submission == null) {
      throw new UserFacingError(`${toolName} is not available now. Read the workflow state again.`);
    }
    try {
      yield* toGenerator(submission.tool.execute("agent-submission", args as never));
    } catch (error) {
      throw new UserFacingError(error instanceof Error ? error.message : String(error), error);
    }
    self.eventTarget.emit("stepUpdate", workflowStageOf(stage));
  },
  {
    operation: "apply the agent's proposal",
    failuresTo: "caller",
    targetStep: (stage: CommandStage, _toolName: string, _args: Record<string, unknown>) =>
      workflowStageOf(stage),
  },
);
