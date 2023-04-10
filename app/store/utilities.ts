import { IStateTreeNode } from "mobx-state-tree";

import { OmitFirstParameter, fromEntries } from "utilities";

export function withSelf<
  Signature extends {
    [Key in string]: (...args: any) => any;
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
    return fromEntries(
      Object.keys(object).map((key) => [
        key,
        (...args: any) => object[key](self, ...args),
      ])
    );
  };
}
