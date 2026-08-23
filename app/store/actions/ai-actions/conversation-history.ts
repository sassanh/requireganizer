import type { AgentMessage, AgentOptions } from "@earendil-works/pi-agent-core";
import { toGenerator } from "mobx-state-tree";

import { runConversationTurn } from "ai-agent/agent";
import { fingerprint } from "contract-domain";
import { UserFacingError } from "lib/errors";
import type { ConversationBranchRecord } from "store/conversation-branches";
import {
  isBranchAttachable,
  makeConversationBranchRecord,
} from "store/conversation-branches";
import type { FlatStore } from "store/store";

import { generator } from "./utilities";

type ConversationEntry = { role: string };

function lastAssistantIndex(messages: readonly ConversationEntry[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") return index;
  }
  return -1;
}

/**
 * Keep a removed transcript tail as a reattachable branch. Siblings that are
 * byte-identical to an already kept tail at the same fork point are skipped
 * so ping-ponging between branches does not accumulate duplicates.
 */
function keepRemovedTail(
  self: FlatStore,
  baseMessages: readonly unknown[],
  removedTail: readonly unknown[],
): void {
  if (removedTail.length === 0) return;
  const record = makeConversationBranchRecord(baseMessages, removedTail);
  const duplicate = (self.conversationBranches ?? []).some(
    (candidate) =>
      candidate.baseLength === record.baseLength &&
      candidate.baseFingerprint === record.baseFingerprint &&
      fingerprint(candidate.messages) === fingerprint(record.messages),
  );
  if (duplicate) return;
  self.putConversationBranch(record);
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
    // The dropped reply is kept as a branch first.
    keepRemovedTail(self, messages.slice(0, assistantIndex), messages.slice(assistantIndex));
    self.setConversation(messages.slice(0, assistantIndex) as unknown[]);

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
    // follow-up message taking the anchor's place. The dropped tail is kept
    // as a branch first so nothing is lost.
    keepRemovedTail(self, messages.slice(0, index), messages.slice(index));
    self.setConversation(messages.slice(0, index) as unknown[]);

    yield* toGenerator(runConversationTurn(self, "branch the conversation", message, streamFn));
  },
  {
    operation: "branch the conversation",
    requirements: [],
  },
);

export const switchConversationBranch = generator(
  function* switchConversationBranch(
    self,
    { id }: { id: string },
  ) {
    const conversation = [...(self.conversation ?? [])] as unknown[];
    const record = (self.conversationBranches ?? []).find(
      (candidate) => candidate.id === id,
    );
    if (record == null) {
      throw new UserFacingError("That conversation branch is no longer available.");
    }
    if (!isBranchAttachable(record, conversation)) {
      throw new UserFacingError(
        "That branch diverged from a part of the conversation that has since changed.",
      );
    }
    // The currently active tail becomes a sibling at the same fork point so
    // switching is a lossless round trip.
    keepRemovedTail(self, conversation.slice(0, record.baseLength), conversation.slice(record.baseLength));
    self.setConversation([
      ...conversation.slice(0, record.baseLength),
      ...record.messages,
    ] as unknown[]);
  },
  {
    operation: "switch the conversation branch",
    requirements: [],
  },
);
