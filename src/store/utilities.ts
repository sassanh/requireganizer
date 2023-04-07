import { IStateTreeNode } from "mobx-state-tree";
import { OmitFirstParameter, fromEntries } from "utilities";

import { Store } from "./store";

export enum Iteration {
  description = "description",
  productOverview = "product-overview",
  userStories = "user-stories",
  requirements = "requirements",
  acceptanceCriteria = "acceptance-criteria",
  testScenarios = "test-scenarios",
}

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
    const store = self as unknown as Store;

    return fromEntries(
      Object.keys(object).map((key) => [
        key,
        (...args: any) => object[key](store, ...args),
      ])
    );
  };
}
