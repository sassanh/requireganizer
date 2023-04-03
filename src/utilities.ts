export { v4 as uuid } from "uuid";

export type Tail<Type extends any[]> = Type extends [any, ...infer Tail_]
  ? Tail_
  : never;
export type OmitFirstParameter<F> = F extends (...args: infer P) => infer R
  ? (...args: Tail<P>) => R
  : never;
export type Entries<T extends { [K in keyof T]: (...args: any) => any }> = {
  [K in keyof T]: [K, (...args: Parameters<T[K]>) => ReturnType<T[K]>];
}[keyof T][];

export function fromEntries<
  T extends { [K in keyof T]: (...args: any) => any }
>(entries: Entries<T>): T {
  return Object.fromEntries(entries) as T;
}
