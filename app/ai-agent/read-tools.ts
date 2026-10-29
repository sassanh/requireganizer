import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

import { CANONICAL_WORKFLOW } from "ai-harness/workflow";
import { WORKFLOW_STAGE_LABELS, WorkflowStage } from "store/constants";
import { reviewStatusOf } from "store/review";
import type { FlatStore } from "store/store";
import { authorLabel, type ReviewThread, waitingFor } from "store/threads";

function textResult(text: string): { content: [{ type: "text"; text: string }]; details: Record<string, never> } {
  return { content: [{ type: "text", text }], details: {} };
}

/** The reviewer model's rejections standing on a stage's unapproved items, each with its reason. */
export function reviewerRejections(store: FlatStore, step: WorkflowStage): { unitId: string; reason: string }[] {
  return store.stageUnits(step).flatMap((unit) => {
    if (unit.approved || unit.outdated) return [];
    const verdict = store.currentVerdictOf(unit.id);
    return verdict?.verdict === "reject" ? [{ unitId: unit.id, reason: verdict.reason }] : [];
  });
}

/** The items one stage holds, in the order the page shows them; null for a stage of other artifacts. */
function stageItems(store: FlatStore, step: WorkflowStage): { id: string }[] | null {
  switch (step) {
    case WorkflowStage.ProductOverview:
      return [...store.productOverview.primaryFeatures, ...store.productOverview.targetUsers];
    case WorkflowStage.UserStories:
      return store.userStories;
    case WorkflowStage.Requirements:
      return store.requirements;
    case WorkflowStage.AcceptanceCriteria:
      return store.acceptanceCriteria;
    default:
      return null;
  }
}

interface ItemText {
  content?: string;
  references?: { id: string }[];
  dependencies?: string[];
}

/**
 * One item as an agent works with it: its code next to its id, its links by
 * code, its status, its open thread, and what its last signature covered
 * where that differs from it now.
 */
function itemView(store: FlatStore, id: string): Record<string, unknown> {
  const unit = store.reviewUnit(id)!;
  const fragment = store.structuralFragmentsCache[id]!;
  const now = unit.content as ItemText;
  const codes = (ids: readonly string[]) => ids.map((linked) => store.getCode(linked) ?? linked);
  const signed = unit.approved ? null : (unit.signature?.signed as ItemText | undefined) ?? null;
  const sinceSigned: Record<string, unknown> = {};
  if (signed != null) {
    if (signed.content !== now.content) sinceSigned.content = signed.content;
    const signedReferences = codes((signed.references ?? []).map((reference) => reference.id));
    if (JSON.stringify(signedReferences) !== JSON.stringify(codes((now.references ?? []).map((reference) => reference.id)))) {
      sinceSigned.references = signedReferences;
    }
    const signedDependencies = codes(signed.dependencies ?? []);
    if (JSON.stringify(signedDependencies) !== JSON.stringify(codes(now.dependencies ?? []))) {
      sinceSigned.dependencies = signedDependencies;
    }
  }
  const thread = store.openThreadOf(id);
  return {
    code: store.unitLabel(id),
    id,
    status: reviewStatusOf(unit),
    ...("priority" in fragment && fragment.priority != null ? { priority: fragment.priority } : {}),
    content: now.content,
    references: codes((now.references ?? []).map((reference) => reference.id)),
    dependencies: codes(now.dependencies ?? []),
    ...(thread == null ? {} : { openThreadId: thread.id }),
    ...(Object.keys(sinceSigned).length === 0 ? {} : { sinceSigned }),
  };
}

function threadView(store: FlatStore, thread: ReviewThread): Record<string, unknown> {
  return {
    threadId: thread.id,
    unitId: thread.unitId,
    unit: store.unitLabel(thread.unitId),
    waitingFor: waitingFor(thread, store.threadAnswerer),
    messages: thread.messages.map(({ author, text, withSubmission }) => ({
      from: author.kind === "person" ? "person" : authorLabel(author),
      text,
      ...(withSubmission ? { withSubmission } : {}),
    })),
  };
}

/**
 * Read-only tools that let the model inspect the live project state instead
 * of receiving artifact content embedded in prompts.
 */
export function buildReadTools(
  store: FlatStore,
  /** The module `store` is, named to a caller that works on whichever module the person has open. */
  options: { moduleName?: string } = {},
): AgentTool[] {
  const { moduleName } = options;
  const validStages = CANONICAL_WORKFLOW.filter((step) => step !== WorkflowStage.Code);
  const stageNamed = (stage: string): WorkflowStage => {
    const step = validStages.find((candidate) => candidate === stage);
    if (step == null) {
      throw new Error(`Unknown stage ${stage}. Valid stages: ${validStages.join(", ")}.`);
    }
    return step;
  };

  const workflowState: AgentTool = {
    name: "get_workflow_state",
    label: "Get workflow state",
    description:
      `${moduleName == null ? "" : "Get the module the person has open in Requireganizer, which every tool reads and submits to, and its workflow state. "}Get the frontier (the first stage that is not complete; only it and earlier stages can change) and each stage's status: pending, completed, outdated, needs-approval, waiting (holds work, read-only until the frontier reaches it), or locked. Each stage up to the frontier lists its outdated items, which must be regenerated, its unapproved review units, and the reviewer model's rejections of them; a later stage gives only how many of each it holds. labels names each listed unit as the page does, such as US-07 or coverage of US-03. Inputs that changed since the stage acknowledged them are listed by id; read them with get_input_changes. Each stage lists its open threads: the person's change requests on its units, with every reply; changeRequestsAnsweredBy names who answers them.`,
    parameters: Type.Object({}),
    execute: async () => {
      const stages = validStages.map((step) => {
        const units = store.stageUnits(step);
        const outdated = units.filter(({ outdated }) => outdated).map(({ id }) => id);
        const unapproved = units.filter(({ approved, outdated }) => !approved && !outdated).map(({ id }) => id);
        const openThreads = store.openThreads(step).map((thread) => threadView(store, thread));
        const summary = {
          stage: step,
          label: WORKFLOW_STAGE_LABELS[step],
          status: store.getStepStatus(step),
          hasArtifacts: store.hasStepArtifacts(step),
        };
        // A stage after the frontier cannot change yet: its units are counted, not listed.
        if (!store.stageIsEditable(step)) {
          return {
            ...summary,
            outdatedItemCount: outdated.length,
            unapprovedUnitCount: unapproved.length,
            ...(openThreads.length === 0 ? {} : { openThreads }),
          };
        }
        const rejections = reviewerRejections(store, step);
        const changedInputIds = store.changedInputIds(step);
        const listed = [...outdated, ...unapproved, ...rejections.map(({ unitId }) => unitId), ...changedInputIds];
        return {
          ...summary,
          outdatedItemIds: outdated,
          unapprovedUnitIds: unapproved,
          reviewerRejections: rejections,
          changedInputIds,
          mechanicalIssues: store.mechanicalIssuesForStage(step).map(({ itemId, message }) => ({
            itemId,
            message,
          })),
          openThreads,
          labels: Object.fromEntries(listed.map((id) => [id, store.unitLabel(id)])),
        };
      });
      return textResult(JSON.stringify({
        ...(moduleName == null ? {} : { module: moduleName }),
        frontier: store.frontier,
        changeRequestsAnsweredBy: store.threadAnswerer,
        stages,
      }));
    },
  };

  const items: AgentTool = {
    name: "get_items",
    label: "Get items",
    description:
      "List one stage's items compactly, in the order the page shows them: each with its code and id, status (approved, draft, outdated or removal-proposed), priority, text, references and dependencies by code, its open thread, and, when it changed since its last signature, sinceSigned with what the signed version had instead. Pass items, as codes or ids, to read only those. For stages of other artifacts, use get_stage_artifacts.",
    parameters: Type.Object({
      stage: Type.String({ description: "The workflow stage to read." }),
      items: Type.Optional(Type.Array(Type.String(), { description: "Codes or ids of the items to read; all of the stage's items when left out." })),
    }),
    execute: async (_toolCallId, params) => {
      const { stage, items: wanted } = params as { stage: string; items?: string[] };
      const step = stageNamed(stage);
      const all = stageItems(store, step);
      if (all == null) throw new Error(`${WORKFLOW_STAGE_LABELS[step]} holds no list of items; read it with get_stage_artifacts.`);
      const chosen = wanted == null
        ? all
        : wanted.map((name) => {
          const item = all.find(({ id }) => id === name || store.getCode(id) === name);
          if (item == null) throw new Error(`${WORKFLOW_STAGE_LABELS[step]} has no item ${name}.`);
          return item;
        });
      return textResult(JSON.stringify({ stage: step, items: chosen.map(({ id }) => itemView(store, id)) }));
    },
  };

  const thread: AgentTool = {
    name: "get_thread",
    label: "Get thread",
    description:
      "Read one of the person's threads: whom it waits for, every message, and its unit; for an item, the item as get_items gives it. A channel event about a change request names its thread. While you answer change requests, reading a thread that waits for you shows the person you are working on it, until you answer or they write again.",
    parameters: Type.Object({
      threadId: Type.String({ description: "The thread to read." }),
    }),
    execute: async (_toolCallId, params) => {
      const { threadId } = params as { threadId: string };
      const found = store.threads.find(({ id }) => id === threadId);
      if (found == null || store.reviewUnit(found.unitId) == null) throw new Error(`No thread ${threadId}.`);
      const isItem = store.structuralFragmentsCache[found.unitId] != null;
      return textResult(JSON.stringify({
        ...threadView(store, found),
        resolved: found.resolvedAt != null,
        stage: store.reviewUnit(found.unitId)!.stage,
        ...(isItem ? { item: itemView(store, found.unitId) } : {}),
      }));
    },
  };

  const stageArtifacts: AgentTool = {
    name: "get_stage_artifacts",
    label: "Get stage artifacts",
    description:
      "Get the full JSON serialization of the current artifacts up to and including one workflow stage. Stages use kebab-case names matching the workflow (e.g. \"product-overview\", \"boundary-design\"). reviewStatus gives each unit's current status: approved, draft, outdated, or removal-proposed. A unit's signature records its last approval and does not say whether it still holds.",
    parameters: Type.Object({
      stage: Type.String({ description: "The workflow stage to read." }),
    }),
    execute: async (_toolCallId, params) => {
      const { stage } = params as { stage: string };
      const step = stageNamed(stage);
      return textResult(JSON.stringify({ ...store.data(step), reviewStatus: store.reviewStatuses(step) }));
    },
  };

  const inputChanges: AgentTool = {
    name: "get_input_changes",
    label: "Get input changes",
    description:
      "Get every input of one stage that changed since the stage acknowledged its inputs: each entry has the input's id and its content before and after (null when it did not exist).",
    parameters: Type.Object({
      stage: Type.String({ description: "The workflow stage whose changed inputs to read." }),
    }),
    execute: async (_toolCallId, params) => {
      const { stage } = params as { stage: string };
      return textResult(JSON.stringify(store.inputChanges(stageNamed(stage))));
    },
  };

  const scaffoldFiles: AgentTool = {
    name: "get_scaffold_files",
    label: "Get scaffold files",
    description:
      "List generated scaffold files with their paths and contents. Pass a path to read one file; omit the path to list all files.",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "An exact scaffold file path." })),
    }),
    execute: async (_toolCallId, params) => {
      const { path } = params as { path?: string };
      if (path != null) {
        const file = store.scaffoldFiles.find(({ path: candidate }) => candidate === path);
        if (file == null) {
          throw new Error(`No scaffold file at ${path}.`);
        }
        return textResult(JSON.stringify(file));
      }
      return textResult(JSON.stringify(
        store.scaffoldFiles.map(({ path: filePath, content }) => ({ path: filePath, content })),
      ));
    },
  };

  return [workflowState, items, thread, stageArtifacts, inputChanges, scaffoldFiles];
}
