import type { generateBoundaryDesign } from "actions/ai/generate-boundary-design";
import type { generateContractTestCases } from "actions/ai/generate-contract-test-cases";
import type { generateContractTestScenarios } from "actions/ai/generate-contract-test-scenarios";
import type { generateImplementationProfile } from "actions/ai/generate-implementation-profile";
import type { generateInterfaceContracts } from "actions/ai/generate-interface-contracts";
import type { generateProductOverview } from "actions/ai/generate-product-overview";
import type { generateProjectSetup } from "actions/ai/generate-project-setup";
import type { GenerateStructuralFragmentParameters , generateStructuralFragment } from "actions/ai/generate-structural-fragment";
import type { generateTestCode } from "actions/ai/generate-test-code";
import type { HandleCommentParameters , handleComment } from "actions/ai/handle-comment";
import type { ActionParameters } from "lib/types";

export const AI_TASK_NAMES = [
  "generate-product-overview",
  "generate-structural-fragment",
  "generate-boundary-design",
  "generate-implementation-profile",
  "generate-interface-contracts",
  "generate-contract-test-scenarios",
  "generate-contract-test-cases",
  "generate-project-setup",
  "generate-test-code",
  "handle-comment",
] as const;

export type AiTaskName = (typeof AI_TASK_NAMES)[number];

export type AiTaskContract = {
  "generate-product-overview": {
    params: ActionParameters;
    result: Awaited<ReturnType<typeof generateProductOverview>>;
  };
  "generate-structural-fragment": {
    params: GenerateStructuralFragmentParameters;
    result: Awaited<ReturnType<typeof generateStructuralFragment>>;
  };
  "generate-boundary-design": {
    params: Parameters<typeof generateBoundaryDesign>[0];
    result: Awaited<ReturnType<typeof generateBoundaryDesign>>;
  };
  "generate-implementation-profile": {
    params: ActionParameters;
    result: Awaited<ReturnType<typeof generateImplementationProfile>>;
  };
  "generate-interface-contracts": {
    params: Parameters<typeof generateInterfaceContracts>[0];
    result: Awaited<ReturnType<typeof generateInterfaceContracts>>;
  };
  "generate-contract-test-scenarios": {
    params: Parameters<typeof generateContractTestScenarios>[0];
    result: Awaited<ReturnType<typeof generateContractTestScenarios>>;
  };
  "generate-contract-test-cases": {
    params: Parameters<typeof generateContractTestCases>[0];
    result: Awaited<ReturnType<typeof generateContractTestCases>>;
  };
  "generate-project-setup": {
    params: Parameters<typeof generateProjectSetup>[0];
    result: Awaited<ReturnType<typeof generateProjectSetup>>;
  };
  "generate-test-code": {
    params: Parameters<typeof generateTestCode>[0];
    result: Awaited<ReturnType<typeof generateTestCode>>;
  };
  "handle-comment": {
    params: HandleCommentParameters;
    result: Awaited<ReturnType<typeof handleComment>>;
  };
};

export type AiTaskRunner = {
  [Task in AiTaskName]: (
    payload: AiTaskContract[Task]["params"],
  ) => Promise<AiTaskContract[Task]["result"]>;
};

export interface AiTaskRunOptions {
  signal?: AbortSignal;
  onSegment?: () => void;
  onThinking?: (delta: string) => void;
}

interface ResultEvent {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export async function consumeAiTaskStream<Value>(
  body: ReadableStream<Uint8Array>,
  options: AiTaskRunOptions = {},
): Promise<Value> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: Value | undefined;

  const handleEvent = (raw: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice("event:".length).trim();
      else if (line.startsWith("data:")) data.push(line.slice("data:".length).trim());
    }
    if (data.length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.join("\n"));
    } catch {
      throw new Error("Received a malformed AI stream event.");
    }
    if (event === "thinking" && typeof parsed === "object" && parsed != null) {
      const text = (parsed as { text?: unknown }).text;
      if (typeof text === "string" && text.length > 0) options.onThinking?.(text);
    } else if (event === "segment") {
      options.onSegment?.();
    } else if (event === "result") {
      const value = parsed as ResultEvent;
      if (value.ok !== true) {
        throw new Error(value.error ?? "The AI operation failed without a message.");
      }
      result = value.result as Value;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const separator = buffer.indexOf("\n\n");
      if (separator < 0) break;
      const raw = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      if (raw.trim().length > 0) handleEvent(raw);
    }
  }

  if (result === undefined) {
    throw new Error("The AI stream ended without a result.");
  }
  return result;
}

export async function runAiTask<Task extends AiTaskName>(
  task: Task,
  payload: AiTaskContract[Task]["params"],
  options: AiTaskRunOptions = {},
): Promise<AiTaskContract[Task]["result"]> {
  const response = await fetch("/api/ai/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task, payload }),
    signal: options.signal,
  });
  if (!response.ok || response.body == null) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `The AI endpoint rejected the request (${response.status}).${detail ? ` ${detail}` : ""}`,
    );
  }
  return consumeAiTaskStream<AiTaskContract[Task]["result"]>(response.body, options);
}
