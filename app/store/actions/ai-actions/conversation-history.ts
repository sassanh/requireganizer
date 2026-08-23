import type { AgentMessage, AgentOptions } from "@earendil-works/pi-agent-core";
import { toGenerator } from "mobx-state-tree";

import { runConversationTurn } from "ai-agent/agent";
import { UserFacingError } from "lib/errors";

import { generator } from "./utilities";

type ConversationEntry = { role: string };

function lastAssistantIndex(messages: readonly ConversationEntry[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") return index;
  }
  return -1;
}

export const regenerateLastReply = generator(
  function* regenerateLastReply(
    self,
    streamFn?: AgentOptions["streamFn"],
  ) {
    const messages = [...(self.conversation ?? [])] as AgentMessage[];
    if (messages.length === 0) {
      throw new UserFacingError("The conversation is empty; nothing to regenerate.");
    }
    const assistantIndex = lastAssistantIndex(messages);
    if (assistantIndex === 0) {
      throw new UserFacingError(
        "The reply cannot be regenerated because the conversation starts with it.",
      );
    }
    // Dropping the trailing reply leaves the transcript ending on a user or
    // tool-result message, which is exactly what a resume continues from. A
    // conversation without any reply yet simply retries its last prompt.
    const truncated = assistantIndex >= 0
      ? messages.slice(0, assistantIndex)
      : messages;
    self.setConversation(truncated as unknown[]);

    yield* toGenerator(runConversationTurn(self, "regenerate the last reply", undefined, streamFn));
  },
  {
    operation: "regenerate the last reply",
    requirements: [],
  },
);

export const branchFromMessage = generator(
  function* branchFromMessage(
    self,
    { index, message }: { index: number; message: string },
    streamFn?: AgentOptions["streamFn"],
  ) {
    const messages = [...(self.conversation ?? [])] as AgentMessage[];
    const anchor = messages[index];
    if (anchor == null || anchor.role !== "user") {
      throw new UserFacingError("That conversation entry can no longer be branched.");
    }
    // Branching keeps everything before the anchor turn, drops the turn
    // itself and everything after it (the reader already saw this exact
    // reverted view before committing), and continues with the fresh
    // follow-up message taking the anchor's place.
    self.setConversation(messages.slice(0, index) as unknown[]);

    yield* toGenerator(runConversationTurn(self, "branch the conversation", message, streamFn));
  },
  {
    operation: "branch the conversation",
    requirements: [],
  },
);
