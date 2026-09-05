import type { AgentOptions } from "@earendil-works/pi-agent-core";
import { toGenerator } from "mobx-state-tree";

import { runConversationTurn } from "ai-agent/agent";
import { endRewind } from "store/timeline/controller";

import { generator } from "./utilities";

export default generator(
  function* sendConversationMessage(
    self,
    { message }: { message: string },
    streamFn?: AgentOptions["streamFn"],
  ) {
    // Submitting the follow-up message is what commits a pending rewind:
    // from this moment the discarded branch is a settled sibling and the
    // rewind can no longer be cancelled — regardless of how the request
    // to the provider turns out.
    endRewind();
    yield* toGenerator(runConversationTurn(self, "answer the conversation", message, streamFn));
  },
  {
    operation: "answer the conversation",
    requirements: [],
    // Conversation carries no stage target, so the upstream gate does not
    // apply; anything it submits goes through the gated submit tools.
    targetStep: null,
  },
);
