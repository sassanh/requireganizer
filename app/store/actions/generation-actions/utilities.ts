import { SnapshotOrInstance, flow, types } from "mobx-state-tree";

import { FlatStore } from "@/store/store";

export const generator = <
  const U extends any[],
  Requirements extends string & keyof SnapshotOrInstance<FlatStore>,
>(
  function_: (
    store: Omit<FlatStore, Requirements> & {
      [key in Requirements]: NonNullable<FlatStore[key]>;
    },
    ...args: U
  ) => Generator<Promise<void>, void, void>,
  { requirements = [] }: { requirements?: Requirements[] } = {
    requirements: [],
  }
) => {
  return flow(function*(
    store: FlatStore,
    ...args: U
  ): Generator<Promise<void>, void, void> {
    if (store.isBusy) {
      return;
    }

    function throwEmptyError(requirement: Requirements) {
      throw new Error(
        `"store.${requirement}" cannot be empty for "${function_.name}"`
      );
    }

    requirements?.forEach((requirement) => {
      const value = store[requirement];
      const a = FlatStore.properties[requirement];
      console.log(
        a.name,
        a.describe(),
        a.identifierAttribute,
        a.is(types.array)
      );
      if (value instanceof Array) {
        if (value.length === 0) throwEmptyError(requirement);
      } else if (value instanceof Set || value instanceof Map) {
        if (value.size === 0) throwEmptyError(requirement);
      } else {
        if (!value) throwEmptyError(requirement);
      }
    });

    try {
      store.businessDepth += 1;

      yield* function_(
        store as Omit<FlatStore, Requirements> & {
          [key in Requirements]: NonNullable<FlatStore[key]>;
        },
        ...args
      );
    } catch (error) {
      console.error(`Error while generating (${function_.name}):`, error);
      alert(error);
    } finally {
      store.businessDepth -= 1;
    }
  });
};
