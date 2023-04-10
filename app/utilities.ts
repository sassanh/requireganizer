import { v4 } from "uuid";

export const uuid = v4;

export type ArrayElement<A> = A extends readonly (infer T)[] ? T : never;

export type Entries<T extends { [K in keyof T]: (...args: any) => any }> = {
  [K in keyof T]: [K, (...args: Parameters<T[K]>) => ReturnType<T[K]>];
}[keyof T][];
export type OmitFirstParameter<F> = F extends (...args: infer P) => infer R
  ? (...args: Tail<P>) => R
  : never;
export type Tail<Type extends any[]> = Type extends [any, ...infer Tail_]
  ? Tail_
  : never;
export function fromEntries<
  T extends { [K in keyof T]: (...args: any) => any }
>(entries: Entries<T>): T {
  return Object.fromEntries(entries) as T;
}
