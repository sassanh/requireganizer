export const HARNESS_PROTOCOL_VERSION = 3 as const;
export const PROMPT_VERSION = "2026-08-12" as const;

export interface HarnessMetadata {
  operation: string;
  promptVersion: typeof PROMPT_VERSION;
  protocolVersion: typeof HARNESS_PROTOCOL_VERSION;
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
