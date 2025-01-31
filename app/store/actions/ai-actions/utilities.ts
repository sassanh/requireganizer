import { SnapshotOrInstance, flow } from "mobx-state-tree";

import { FunctionCall, ManipulationFunction } from "lib/types";
import { FlatStore } from "store/store";
import { isEnumMember } from "utilities";

export function generator<
  const U extends any[],
  Requirements extends string & keyof SnapshotOrInstance<FlatStore>,
>(
  function_: (
    store: Omit<FlatStore, Requirements> & {
      [key in Requirements]: NonNullable<FlatStore[key]>;
    },
    ...args: U
  ) => Generator<Promise<any>, void, any>,
  { requirements = [] }: { requirements?: Requirements[] } = {
    requirements: [],
  },
) {
  return flow(function* (
    store: FlatStore,
    ...args: U
  ): Generator<Promise<any>, void, any> {
    if (store.isBusy) {
      return;
    }

    function throwEmptyError(requirement: Requirements) {
      throw new Error(
        `"store.${requirement}" cannot be empty for "${function_.name}"`,
      );
    }

    requirements?.forEach((requirement) => {
      const value = store[requirement];
      if (value instanceof Array) {
        if (value.length === 0) throwEmptyError(requirement);
      } else if (value instanceof Set || value instanceof Map) {
        if (value.size === 0) throwEmptyError(requirement);
      } else {
        if (!value) throwEmptyError(requirement);
      }
    });

    try {
      store.businessCounter += 1;

      yield* function_(
        store as Omit<FlatStore, Requirements> & {
          [key in Requirements]: NonNullable<FlatStore[key]>;
        },
        ...args,
      );
    } catch (error) {
      console.error(`Error while generating (${function_.name}):`, error);
    } finally {
      store.businessCounter -= 1;
    }
  });
}

export function handleFunctionCall(
  store: FlatStore,
  functionCall: FunctionCall,
) {
  const name = functionCall.name;
  const parameters = functionCall.arguments;

  if (!name || !parameters) {
    return;
  }

  if (!isEnumMember(name, ManipulationFunction)) {
    return;
  }

  store[name](JSON.parse(parameters));
}
