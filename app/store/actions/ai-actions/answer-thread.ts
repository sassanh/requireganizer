import type { AgentOptions } from "@earendil-works/pi-agent-core";
import { toGenerator } from "mobx-state-tree";

import { UserFacingError } from "lib/errors";
import type { WorkflowStage } from "store/constants";
import { threadText } from "store/threads";

import { generator } from "./utilities";

/** The text of the conversation's last assistant message: the writer's reply to the person. */
function lastReply(conversation: readonly unknown[]): string | null {
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const message = conversation[index] as { role?: unknown; content?: unknown };
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const text = (message.content as { type?: unknown; text?: unknown }[])
      .map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
    return text.length > 0 ? text : null;
  }
  return null;
}

/** What Requireganizer's writer takes a thread up as while it answers. */
const REQUIREGANIZER_ANSWERER = "requireganizer";

/**
 * Requireganizer's writer answers a thread of the stage: it reads the whole
 * thread as the change request, changes the unit or says why not, and its
 * reply joins the thread.
 */
export default generator(
  function* answerThread(
    self,
    step: WorkflowStage,
    threadId: string,
    streamFn?: AgentOptions["streamFn"],
  ) {
    const thread = self.openThreads(step).find(({ id }) => id === threadId);
    if (thread == null) throw new UserFacingError("This thread is no longer open.");
    const command = self.changeRequestCommand(thread.unitId, threadText(thread));
    if (command == null) throw new Error(`${thread.unitId} takes no change requests.`);
    const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
    const { writerModel } = yield* toGenerator(import("ai-agent/settings"));
    const author = { kind: "model" as const, model: writerModel().id };
    // Checked before the model runs, so a refused answer costs no turn.
    const problem = self.threadAnswerProblem([{ threadId, text: "-" }], author, step);
    if (problem != null) throw new UserFacingError(problem);
    const before = self.json(step);
    self.takeUpThread(threadId, REQUIREGANIZER_ANSWERER);
    try {
      yield* toGenerator(runAgentCommand(self, "apply the requested change", command, streamFn));
      const changed = self.json(step) !== before;
      self.answerThreads(
        [{ threadId, text: lastReply(self.conversation ?? []) ?? (changed ? "Changed it." : "No change.") }],
        author,
        { withSubmission: changed },
      );
    } finally {
      self.releaseThreads(REQUIREGANIZER_ANSWERER);
    }
    self.eventTarget.emit("stepUpdate", step);
  },
  {
    operation: "apply the requested change",
    targetStep: (step: WorkflowStage, _threadId: string, _streamFn?: AgentOptions["streamFn"]) => step,
  },
);
