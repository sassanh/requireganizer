import { AsyncLocalStorage } from "node:async_hooks";

export interface ThinkingSink {
  onThinking: (delta: string) => void;
  onSegment?: () => void;
  signal?: AbortSignal;
}

const storage = new AsyncLocalStorage<ThinkingSink>();

export function runWithThinkingSink<Value>(
  sink: ThinkingSink,
  run: () => Promise<Value>,
): Promise<Value> {
  return storage.run(sink, run);
}

export function getThinkingSink(): ThinkingSink | undefined {
  return storage.getStore();
}
