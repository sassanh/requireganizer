import { v4 } from "uuid";

export const uuid = v4;

export type ArrayElement<A> = A extends readonly (infer T)[] ? T : never;

export function assertUnreachable(
  _: never,
  message = "Didn't expect to get here",
): never {
  throw new Error(message);
}

export function isEnumMember<E>(
  value: unknown,
  enumArg: Record<string | number | symbol, E>,
): value is E {
  return (Object.values(enumArg) as unknown[]).includes(value);
}
