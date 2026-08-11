import { IStateTreeNode } from "mobx-state-tree";

type BoundAction<Action> = Action extends (
  self: infer _Self,
  ...parameters: infer Parameters
) => infer Result
  ? (...parameters: Parameters) => Result
  : never;

type BoundActions<Actions> = {
  [Key in keyof Actions]: BoundAction<Actions[Key]>;
};

export function withSelf<Actions extends object>(actions: Actions) {
  return (self: IStateTreeNode): BoundActions<Actions> => {
    const entries = Object.entries(actions).map(([name, value]) => {
      const action = value as (
        self: IStateTreeNode,
        ...parameters: unknown[]
      ) => unknown;

      return [name, (...parameters: unknown[]) => action(self, ...parameters)];
    });

    return Object.fromEntries(entries) as BoundActions<Actions>;
  };
}
