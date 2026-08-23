import type { AgentOptions } from "@earendil-works/pi-agent-core";
import { toGenerator } from "mobx-state-tree";

import { runConversationTurn } from "ai-agent/agent";

import { generator } from "./utilities";

export default generator(
  function* sendConversationMessage(
    self,
    { message }: { message: string },
    streamFn?: AgentOptions["streamFn"],
  ) {
    yield* toGenerator(runConversationTurn(self, "answer the conversation", message, streamFn));
  },
  {
    operation: "answer the conversation",
    requirements: [],
  },
);
