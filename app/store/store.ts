"use client";

import { applySnapshot, type Instance, types } from "mobx-state-tree";
import { createContext, useContext } from "react";

import { InvalidJsonError, isRecord } from "lib/json";
import { assertModuleSnapshotSchema, MODULE_SCHEMA_VERSION } from "lib/projectSchema";
import { REQUIREMENTS_ENGINEERING_STAGES } from "requirements-engineering";
import { parseThreads, type ThreadInHand, Workflow, workflowModuleModel } from "workflow";

export { MODULE_SCHEMA_VERSION, PROJECT_SCHEMA_VERSION } from "lib/projectSchema";

/** The workflow every module of a project follows. */
export const WORKFLOW = new Workflow({ stages: REQUIREMENTS_ENGINEERING_STAGES });

/**
 * The volatile state the interface reads. It never enters a snapshot or a
 * patch, so the authority sends it to replicas separately.
 */
export interface ReplicatedVolatileState {
  /** The thread turns an answerer is at work on now. */
  threadsInHand: ThreadInHand[];
}

const REPLICATED_VOLATILE_KEYS = ["threadsInHand"] as const satisfies readonly (keyof ReplicatedVolatileState)[];

export const Store = workflowModuleModel(WORKFLOW)
  .props({
    schemaVersion: types.optional(types.literal(MODULE_SCHEMA_VERSION), MODULE_SCHEMA_VERSION),
  })
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
    /** Replace this module with a stored one, checked first. */
    import(value: unknown) {
      applySnapshot(self, parseModuleSnapshot(value));
    },
  }));

export type Store = Instance<typeof Store>;

/** The replicated volatile values of a store, as the authority sends them. */
export function replicatedVolatileState(store: Store): ReplicatedVolatileState {
  const values: Partial<Record<keyof ReplicatedVolatileState, unknown>> = {};
  for (const key of REPLICATED_VOLATILE_KEYS) values[key] = store[key];
  return values as ReplicatedVolatileState;
}

function parseItem(stage: string, value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new InvalidJsonError(`${label} must be an object.`);
  if (!WORKFLOW.isKind(value.kind) || WORKFLOW.stageOfKind(value.kind) !== stage) {
    throw new InvalidJsonError(`${label} has kind ${JSON.stringify(value.kind)}, which ${WORKFLOW.stage(stage).label} does not hold.`);
  }
  const isFieldValue = (field: unknown) =>
    field === null || typeof field === "string" || (Array.isArray(field) && field.every((entry) => typeof entry === "string"));
  if (!isRecord(value.content) || !Object.values(value.content).every(isFieldValue)) {
    throw new InvalidJsonError(`${label} content must map field names to text, a list of item ids, or null.`);
  }
  return value;
}

/**
 * A stored module, checked: every stage is one the workflow defines, and
 * every item is of a kind its stage holds. The model checks the rest.
 */
export function parseModuleSnapshot(value: unknown): Record<string, unknown> {
  assertModuleSnapshotSchema(value);
  const stages = value.stages ?? {};
  if (!isRecord(stages)) throw new InvalidJsonError("Stages must be an object.");
  const parsedStages = Object.fromEntries(
    Object.entries(stages).map(([stage, entry]) => {
      if (!WORKFLOW.isStage(stage)) throw new InvalidJsonError(`There is no stage ${stage}.`);
      if (!isRecord(entry)) throw new InvalidJsonError(`Stage ${stage} must be an object.`);
      const items = entry.items ?? [];
      if (!Array.isArray(items)) throw new InvalidJsonError(`Stage ${stage} items must be an array.`);
      return [stage, { ...entry, items: items.map((item, index) => parseItem(stage, item, `${WORKFLOW.stage(stage).label} item ${index + 1}`)) }];
    }),
  );
  const candidate: Record<string, unknown> = {
    schemaVersion: MODULE_SCHEMA_VERSION,
    stages: parsedStages,
    threads: parseThreads(value.threads),
  };
  if (!Store.is(candidate)) throw new InvalidJsonError("The module does not have the shape Requireganizer stores.");
  return candidate;
}

/** The text a project list shows for a module: the first text of its first stage. */
export function moduleDescription(snapshot: Record<string, unknown>): string {
  const stages = snapshot.stages as Record<string, { items?: { content?: Record<string, unknown> }[] }> | undefined;
  const first = stages?.[WORKFLOW.firstStage]?.items?.[0]?.content?.text;
  return typeof first === "string" ? first.slice(0, 200) : "";
}

/** The one way a stored module snapshot becomes a live store. */
export function createModuleStore(snapshot: unknown): Store {
  return Store.create(parseModuleSnapshot(snapshot));
}

export const storeContext = createContext<Store>(null!);
export const useStore = () => useContext(storeContext);
