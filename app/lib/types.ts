export const HARNESS_PROTOCOL_VERSION = 5 as const;
export const PROMPT_VERSION = "2026-08-13.1" as const;

export type ProviderCallOutcome =
  | "success"
  | "needs_input"
  | "rejected"
  | "failed";

export interface ProviderTokenUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ProviderCallMetadata {
  operation: string;
  attempt: number;
  promptVersion: typeof PROMPT_VERSION;
  protocolVersion: typeof HARNESS_PROTOCOL_VERSION;
  startedAt: string;
  durationMs: number;
  provider: string;
  model: string;
  authenticationMode?: "anonymous" | "configured";
  outcome: ProviderCallOutcome;
  toolCallCount: number;
  toolName?: string;
  finishReason?: string;
  responseId?: string;
  requestId?: string;
  httpStatus?: number;
  errorCode?: string;
  usage?: ProviderTokenUsage;
  adapterIds?: string[];
  interfaceContractRevisionIds?: string[];
  subjectContractRevisionIds?: string[];
}

export interface ProviderCallRecord
  extends Omit<ProviderCallMetadata, "promptVersion" | "protocolVersion"> {
  id: string;
  promptVersion: string;
  protocolVersion: number;
}

export interface HarnessMetadata {
  operation: string;
  promptVersion: typeof PROMPT_VERSION;
  protocolVersion: typeof HARNESS_PROTOCOL_VERSION;
  providerCalls: ProviderCallMetadata[];
}

export type HarnessErrorCode =
  | "invalid_tool_response"
  | "provider_request_failed";

export type HarnessResult<Value> =
  | {
    status: "success";
    value: Value;
    metadata: HarnessMetadata;
  }
  | {
    status: "needs_input";
    message: string;
    metadata: HarnessMetadata;
  }
  | {
    status: "error";
    code: HarnessErrorCode;
    message: string;
    details?: string;
    metadata: HarnessMetadata;
  };

export interface ActionParameters {
  state: string;
}
