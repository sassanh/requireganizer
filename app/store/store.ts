"use client";

import type { Instance, SnapshotIn } from "mobx-state-tree";
import { createContext, useContext } from "react";

import { REQUIREMENTS_ENGINEERING_STAGES } from "requirements-engineering";
import type { ModuleContent } from "storage-and-recovery";
import { TEST_DESIGN_STAGES } from "test-design";
import { type TurnInHand, Workflow, workflowModuleModel } from "workflow";

import { KIND_EXAMPLES } from "./examples";

/** The workflow every module of a project follows. */
export const WORKFLOW = new Workflow({ stages: [...REQUIREMENTS_ENGINEERING_STAGES, ...TEST_DESIGN_STAGES], examples: KIND_EXAMPLES });

/**
 * The volatile state the interface reads. It never enters a snapshot or a
 * patch, so the authority sends it to replicas separately.
 */
export interface ReplicatedVolatileState {
  /** The turns an answerer is at work on now. */
  turnsInHand: TurnInHand[];
}

const REPLICATED_VOLATILE_KEYS = ["turnsInHand"] as const satisfies readonly (keyof ReplicatedVolatileState)[];

export const Store = workflowModuleModel(WORKFLOW)
  .named("Store")
  .views(() => ({
    get workflow(): Workflow {
      return WORKFLOW;
    },
    stageLabel(stage: string): string {
      return WORKFLOW.stage(stage).label;
    },
  }))
  .actions((self) => ({
    /** Replica only: take the authority's replicated volatile values. */
    mirrorVolatileState(values: Partial<ReplicatedVolatileState>) {
      Object.assign(self, values);
    },
  }));

export type Store = Instance<typeof Store>;

/** The replicated volatile values of a store, as the authority sends them. */
export function replicatedVolatileState(store: Store): ReplicatedVolatileState {
  const values: Partial<Record<keyof ReplicatedVolatileState, unknown>> = {};
  for (const key of REPLICATED_VOLATILE_KEYS) values[key] = store[key];
  return values as ReplicatedVolatileState;
}

/** The one way a module's content, read by `parseProject`, becomes a live store. */
export function createModuleStore(content: ModuleContent): Store {
  return Store.create(content as unknown as SnapshotIn<typeof Store>);
}

export const storeContext = createContext<Store>(null!);
export const useStore = () => useContext(storeContext);
