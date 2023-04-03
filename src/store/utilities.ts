import { IStateTreeNode } from "mobx-state-tree";

import { Store } from "./store";

type OmitFirstParameter<F> = F extends (x: any, ...args: infer P) => infer R
  ? (...args: P) => R
  : never;
type Entries<T extends { [K in keyof T]: (...args: any) => any }> = {
  [K in keyof T]: [
    K,
    (store: Store, ...args: Parameters<T[K]>) => ReturnType<T[K]>
  ];
}[keyof T][];

function fromEntries<T extends { [K in keyof T]: (...args: any) => any }>(
  entries: Entries<T>
): T {
  return Object.fromEntries(entries) as T;
}

export function withSelf<
  Signature extends {
    [Key in string]: (store: IStateTreeNode, ...args: any) => any;
  }
>(
  object: Signature
): (self: IStateTreeNode) => {
  [Key in keyof Signature]: OmitFirstParameter<Signature[Key]>;
} {
  return (
    self: IStateTreeNode
  ): {
    [Key in keyof Signature]: OmitFirstParameter<Signature[Key]>;
  } => {
    const store = self as unknown as Store;

    return fromEntries(
      Object.keys(object).map((key) => [
        key,
        (...args: any) => object[key](store, ...args),
      ])
    );
  };
}
