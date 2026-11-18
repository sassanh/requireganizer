"use client";

import type { Instance, SnapshotIn } from "mobx-state-tree";
import { createContext, useContext } from "react";

import { REQUIREMENTS_ENGINEERING_STAGES } from "requirements-engineering";
import type { ModuleContent } from "storage";
import { TEST_DESIGN_STAGES } from "test-design";
import { Workflow, workflowModuleModel } from "workflow";

import { KIND_EXAMPLES } from "./examples";

/** The workflow every module of a project follows. */
export const WORKFLOW = new Workflow({ stages: [...REQUIREMENTS_ENGINEERING_STAGES, ...TEST_DESIGN_STAGES], examples: KIND_EXAMPLES });

export const Store = workflowModuleModel(WORKFLOW)
  .named("Store")
  .views(() => ({
    get workflow(): Workflow {
      return WORKFLOW;
    },
    stageLabel(stage: string): string {
      return WORKFLOW.stage(stage).label;
    },
  }));

export type Store = Instance<typeof Store>;

/** The one way a module's content, read by `parseProject`, becomes a live store. */
export function createModuleStore(content: ModuleContent): Store {
  return Store.create(content as unknown as SnapshotIn<typeof Store>);
}

export const storeContext = createContext<Store>(null!);
export const useStore = () => useContext(storeContext);
