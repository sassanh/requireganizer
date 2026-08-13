import "server-only";

import {
  AUTHENTICATION_MODE,
  MODEL,
  PROVIDER,
  generateToolResponse,
} from "actions/lib/ai";
import {
  executeStructuredHarnessTask,
  StructuredHarnessTask,
} from "ai-harness/runner";
import { HarnessResult } from "lib/types";

export function runStructuredHarnessTask<Value>(
  task: StructuredHarnessTask<Value>,
): Promise<HarnessResult<Value>> {
  return executeStructuredHarnessTask({
    ...task,
    generate: generateToolResponse,
    provider: PROVIDER,
    providerModel: MODEL,
    authenticationMode: AUTHENTICATION_MODE,
  });
}
