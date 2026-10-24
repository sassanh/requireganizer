import { isRecord } from "lib/json";

import type { ClientMessage } from "./protocol";

/** A client message read off a transport, or null when it is not a well-formed request. */
export function parseClientMessage(wire: string): ClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(wire);
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    value.type !== "request" ||
    typeof value.id !== "number" ||
    typeof value.name !== "string" ||
    !Array.isArray(value.args)
  ) {
    return null;
  }
  return value as unknown as ClientMessage;
}
