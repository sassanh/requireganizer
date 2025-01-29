import { v4 } from "uuid";

export const uuid = v4;

export type ArrayElement<A> = A extends readonly (infer T)[] ? T : never;

export type Entries<T extends { [K in keyof T]: (...args: any) => any }> = {
  [K in keyof T]: [K, (args: Parameters<T[K]>) => ReturnType<T[K]>];
}[keyof T][];
export type OmitFirstParameter<F> = F extends (
  self: any,
  ...args: infer P
) => infer R
  ? (...args: P) => R
  : never;
export function fromEntries<T extends { [K in keyof T]: (args: any) => any }>(
  entries: Entries<T>,
): T {
  return Object.fromEntries(entries) as T;
}

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
