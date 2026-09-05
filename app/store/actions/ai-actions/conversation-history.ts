import type { AgentOptions } from "@earendil-works/pi-agent-core";
import { toGenerator } from "mobx-state-tree";

import { runConversationTurn } from "ai-agent/agent";
import { UserFacingError } from "lib/errors";
import {
  rewindBeforeLastTurn,
} from "store/timeline/controller";

import { generator } from "./utilities";

export const regenerateLastReply = generator(
  function* regenerateLastReply(
    self,
    streamFn?: AgentOptions["streamFn"],
  ) {
    // The replay is the transcript truncated at the last user message: the
    // agent is seeded with a transcript ending in a user message — the only
    // state `continue()` can regenerate from, and one that survives page
    // refreshes because it lives in the store, not the agent session.
    const messages = [...(self.conversation ?? [])] as { role?: string }[];
    if (messages.length === 0) {
      throw new UserFacingError(
        "The conversation is empty; nothing to regenerate.",
      );
    }
    let lastUserIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "user") {
        lastUserIndex = index;
        break;
      }
    }
    if (lastUserIndex === -1) {
      throw new UserFacingError(
        "The reply cannot be regenerated because the conversation starts with it.",
      );
    }
    const replay = messages.slice(0, lastUserIndex + 1);

    // Preferred path: rewind to the state before the exchange — artifacts
    // and conversation revert together, and the old reply stays as a
    // sibling branch in the tree.
    rewindBeforeLastTurn();
    // Whether or not a tree rewind happened (conversations with no tree
    // turns fall back), seed the store transcript with the replay prefix.
    self.setConversation(replay);

    yield* toGenerator(
      runConversationTurn(self, "regenerate the last reply", undefined, streamFn),
    );
  },
  {
    operation: "regenerate the last reply",
    requirements: [],
    // Conversation carries no stage target, so the upstream gate does not
    // apply; anything it submits goes through the gated submit tools.
    targetStep: null,
  },
);
