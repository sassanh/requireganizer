import type { ContractSuite } from "./types";

const REVISION_METADATA_KEYS = new Set([
  "approvedAt",
  "createdAt",
  "revision",
  "revisionId",
  "status",
]);

const IDENTITY_KEYS = [
  "interfaceId",
  "subjectId",
  "verificationObligationId",
  "semanticInteractionId",
  "operationId",
  "path",
  "id",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function pointerToken(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function display(value: unknown): string {
  const result = JSON.stringify(value);
  return result === undefined ? "undefined" : result;
}

function arrayIdentity(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const key of IDENTITY_KEYS) {
    if (typeof value[key] === "string") return `${key}=${value[key]}`;
  }
  return null;
}

function keyedArray(value: readonly unknown[]): Map<string, unknown> | null {
  const entries = value.map((item) => [arrayIdentity(item), item] as const);
  if (entries.some(([key]) => key == null)) return null;
  const keys = entries.map(([key]) => key!);
  if (new Set(keys).size !== keys.length) return null;
  return new Map(entries as readonly (readonly [string, unknown])[]);
}

function appendReplacement(
  result: string[],
  path: string,
  before: unknown,
  after: unknown,
): void {
  if (
    typeof before === "string" &&
    typeof after === "string" &&
    (before.includes("\n") || after.includes("\n"))
  ) {
    result.push(`@@ ${path} @@`);
    result.push(...before.split("\n").map((line) => `- ${line}`));
    result.push(...after.split("\n").map((line) => `+ ${line}`));
    return;
  }
  result.push(`- ${path}: ${display(before)}`);
  result.push(`+ ${path}: ${display(after)}`);
}

function collectDiff(
  before: unknown,
  after: unknown,
  path: string,
  result: string[],
): void {
  if (Object.is(before, after)) return;

  if (Array.isArray(before) && Array.isArray(after)) {
    const beforeById = keyedArray(before);
    const afterById = keyedArray(after);
    if (beforeById != null && afterById != null) {
      const keys = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort();
      for (const key of keys) {
        const childPath = `${path}/${pointerToken(key)}`;
        if (!beforeById.has(key)) {
          result.push(`+ ${childPath}: ${display(afterById.get(key))}`);
        } else if (!afterById.has(key)) {
          result.push(`- ${childPath}: ${display(beforeById.get(key))}`);
        } else {
          collectDiff(beforeById.get(key), afterById.get(key), childPath, result);
        }
      }
      return;
    }
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      const childPath = `${path}/${index}`;
      if (index >= before.length) {
        result.push(`+ ${childPath}: ${display(after[index])}`);
      } else if (index >= after.length) {
        result.push(`- ${childPath}: ${display(before[index])}`);
      } else {
        collectDiff(before[index], after[index], childPath, result);
      }
    }
    return;
  }

  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((key) => !REVISION_METADATA_KEYS.has(key))
      .sort();
    for (const key of keys) {
      const childPath = `${path}/${pointerToken(key)}`;
      if (!(key in before)) {
        result.push(`+ ${childPath}: ${display(after[key])}`);
      } else if (!(key in after)) {
        result.push(`- ${childPath}: ${display(before[key])}`);
      } else {
        collectDiff(before[key], after[key], childPath, result);
      }
    }
    return;
  }

  appendReplacement(result, path, before, after);
}

export function formatContractSuiteDiff(
  before: ContractSuite,
  after: ContractSuite,
): string {
  const result: string[] = ["--- approved contract suite", "+++ reconciled draft"];
  collectDiff(before, after, "", result);
  if (result.length === 2) result.push("No material artifact changes.");
  return result.join("\n");
}
