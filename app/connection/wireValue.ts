import { isStateTreeNode } from "mobx-state-tree";

function describeValue(value: unknown): string {
  if (isStateTreeNode(value)) return "a store node (pass its id instead)";
  if (typeof value === "function") return "a function";
  if (typeof value === "number") return `the number ${value}`;
  if (typeof value === "object" && value != null) {
    return `an instance of ${value.constructor?.name ?? "an unknown class"}`;
  }
  return `a ${typeof value}`;
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function checkValue(value: unknown, at: string, enclosing: Set<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) return;
  const isArray = Array.isArray(value);
  if (
    typeof value !== "object" ||
    isStateTreeNode(value) ||
    (!isArray && !isPlainObject(value))
  ) {
    throw new TypeError(`${at} is ${describeValue(value)}, which cannot cross to the project host.`);
  }
  if (enclosing.has(value)) {
    throw new TypeError(`${at} contains itself, which JSON cannot represent.`);
  }
  enclosing.add(value);
  if (isArray) {
    for (let i = 0; i < value.length; i += 1) {
      if (!(i in value) || value[i] === undefined) {
        throw new TypeError(`${at}[${i}] is undefined, which JSON turns into null.`);
      }
      checkValue(value[i], `${at}[${i}]`, enclosing);
    }
  } else {
    for (const [key, entry] of Object.entries(value)) {
      // JSON drops an undefined property, which reads back the same.
      if (entry !== undefined) checkValue(entry, `${at}.${key}`, enclosing);
    }
  }
  enclosing.delete(value);
}

/**
 * The arguments of a call that crosses to the host, checked to survive JSON
 * unchanged. Trailing undefined arguments are dropped, since a missing
 * argument reads back the same; any other value JSON would alter throws.
 */
export function wireArguments(name: string, args: readonly unknown[]): unknown[] {
  let length = args.length;
  while (length > 0 && args[length - 1] === undefined) length -= 1;
  const kept = args.slice(0, length);
  kept.forEach((argument, index) => {
    if (argument === undefined) {
      throw new TypeError(
        `Argument ${index + 1} of ${name} is undefined, which JSON turns into null. Pass null.`,
      );
    }
    checkValue(argument, `Argument ${index + 1} of ${name}`, new Set());
  });
  return kept;
}
