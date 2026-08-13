import type { ProviderCallRecord } from "./types";

const CSV_COLUMNS = [
  "id",
  "operation",
  "attempt",
  "startedAt",
  "durationMs",
  "provider",
  "model",
  "authenticationMode",
  "outcome",
  "toolCallCount",
  "toolName",
  "finishReason",
  "responseId",
  "requestId",
  "httpStatus",
  "errorCode",
  "promptVersion",
  "protocolVersion",
  "inputTokens",
  "cachedInputTokens",
  "cacheWriteTokens",
  "outputTokens",
  "totalTokens",
  "adapterIds",
  "interfaceContractRevisionIds",
  "subjectContractRevisionIds",
] as const;

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function providerCallsToCsv(
  calls: readonly ProviderCallRecord[],
): string {
  const rows = calls.map((call) => {
    const values: Record<(typeof CSV_COLUMNS)[number], unknown> = {
      id: call.id,
      operation: call.operation,
      attempt: call.attempt,
      startedAt: call.startedAt,
      durationMs: call.durationMs,
      provider: call.provider,
      model: call.model,
      authenticationMode: call.authenticationMode,
      outcome: call.outcome,
      toolCallCount: call.toolCallCount,
      toolName: call.toolName,
      finishReason: call.finishReason,
      responseId: call.responseId,
      requestId: call.requestId,
      httpStatus: call.httpStatus,
      errorCode: call.errorCode,
      promptVersion: call.promptVersion,
      protocolVersion: call.protocolVersion,
      inputTokens: call.usage?.inputTokens,
      cachedInputTokens: call.usage?.cachedInputTokens,
      cacheWriteTokens: call.usage?.cacheWriteTokens,
      outputTokens: call.usage?.outputTokens,
      totalTokens: call.usage?.totalTokens,
      adapterIds: call.adapterIds?.join("|"),
      interfaceContractRevisionIds: call.interfaceContractRevisionIds?.join("|"),
      subjectContractRevisionIds: call.subjectContractRevisionIds?.join("|"),
    };
    return CSV_COLUMNS.map((column) => csvCell(values[column])).join(",");
  });

  return [CSV_COLUMNS.join(","), ...rows].join("\r\n");
}

export function providerCallExportBaseName(projectName: string): string {
  const safeName = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${safeName || "project"}-provider-calls`;
}
