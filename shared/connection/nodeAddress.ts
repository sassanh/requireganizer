import {
  escapeJsonPath,
  getIdentifier,
  getParent,
  getPathParts,
  getType,
  hasParent,
  type IAnyStateTreeNode,
  isArrayType,
  isStateTreeNode,
  tryResolve,
} from "mobx-state-tree";

import type { AddressStep } from "./protocol";

/** The address of a node in its tree, naming array items by identifier where they have one. */
export function addressOf(node: IAnyStateTreeNode): AddressStep[] {
  const steps: AddressStep[] = [];
  let current = node;
  while (hasParent(current)) {
    const parent: IAnyStateTreeNode = getParent(current);
    const id = isArrayType(getType(parent)) ? getIdentifier(current) : null;
    steps.unshift(id == null ? getPathParts(current).at(-1)! : { id });
    current = parent;
  }
  return steps;
}

/** The node an address names under `root`, if it still exists. */
export function resolveAddress(
  root: IAnyStateTreeNode,
  steps: readonly AddressStep[],
): IAnyStateTreeNode | undefined {
  let current: unknown = root;
  for (const step of steps) {
    if (!isStateTreeNode(current)) return undefined;
    if (typeof step === "string") {
      current = tryResolve(current, `./${escapeJsonPath(step)}`);
      continue;
    }
    if (!isArrayType(getType(current))) return undefined;
    current = (current as unknown as unknown[]).find(
      (item) => isStateTreeNode(item) && getIdentifier(item) === step.id,
    );
  }
  return isStateTreeNode(current) ? current : undefined;
}
