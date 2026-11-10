import { createModuleStore } from "store";
import type { SignatureRecord, Thread } from "workflow";

import { type ModuleContent, moduleContentOf, type ProjectState, serializeProject, type StageContent } from "./projectState";

/** What an export holds besides every module and its items. */
export interface ExportOptions {
  /**
   * The threads it holds, all or only the open ones, each with or without
   * the times of its messages and resolution; or none.
   */
  threads: { which: "all" | "open"; withTimes: boolean } | "none";
  signatures: "with times" | "without times" | "none";
}

/** The whole project, as an export holds it unless asked otherwise. */
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  threads: { which: "all", withTimes: true },
  signatures: "with times",
};

function exportedThreads(threads: readonly Thread[], options: ExportOptions["threads"]): Thread[] {
  if (options === "none") return [];
  const kept = options.which === "all" ? threads : threads.filter(({ resolution }) => resolution == null);
  if (options.withTimes) return [...kept];
  return kept.map((thread) => ({
    ...thread,
    messages: thread.messages.map((message) => ({ ...message, at: null })),
    resolution: thread.resolution == null ? null : { at: null },
  }));
}

/** A signature as the export holds it: as it is, without its time, or not at all. */
function exportedSignature<Signature extends SignatureRecord>(
  signature: Signature,
  option: ExportOptions["signatures"],
): Signature | null {
  switch (option) {
    case "with times":
      return signature;
    case "without times":
      return { ...signature, at: null };
    case "none":
      return null;
  }
}

function exportedSignatures<Signature extends SignatureRecord>(
  signatures: Readonly<Record<string, Signature>>,
  option: ExportOptions["signatures"],
): Record<string, Signature> {
  return Object.fromEntries(
    Object.entries(signatures).flatMap(([id, signature]) => {
      const exported = exportedSignature(signature, option);
      return exported == null ? [] : [[id, exported]];
    }),
  );
}

/**
 * A stage with every signature it records as the export holds it: on its
 * items, on their removals, on its coverages and on its impacts. Without
 * signatures, an item is unsigned; removed items are already left out.
 */
function exportedStage(stage: StageContent, option: ExportOptions["signatures"]): StageContent {
  if (option === "with times") return stage;
  const signed = <Signature extends SignatureRecord>(signature: Signature | null): Signature | null =>
    signature == null ? null : exportedSignature(signature, option);
  return {
    ...stage,
    items: stage.items.map((item) => ({
      ...item,
      signature: signed(item.signature),
      removal: item.removal == null ? null : { ...item.removal, signature: signed(item.removal.signature) },
    })),
    coverages: exportedSignatures(stage.coverages, option),
    impacts: exportedSignatures(stage.impacts, option),
  };
}

/**
 * Without signatures a signed removal could only come back as a proposed
 * one, so items whose removal is signed leave the export the way they leave
 * the project once their removal settles.
 */
function withoutRemovedItems(content: ModuleContent): ModuleContent {
  const store = createModuleStore(content);
  store.deleteRemovedItems();
  return moduleContentOf(store);
}

function exportedContent(stored: ModuleContent, options: ExportOptions): ModuleContent {
  const content = options.signatures === "none" ? withoutRemovedItems(stored) : stored;
  return {
    ...content,
    stages: Object.fromEntries(
      Object.entries(content.stages).map(([stage, stored]) => [stage, exportedStage(stored, options.signatures)]),
    ),
    threads: exportedThreads(content.threads, options.threads),
  };
}

/**
 * The bytes of an export of a state: the project with the threads and
 * signatures the options leave in, through the one serializer, so two
 * exports with the same options differ only where the project did. It
 * never holds the history or restore points, which are not part of a state.
 */
export function buildExport(state: ProjectState, options: ExportOptions): string {
  return serializeProject({
    ...state,
    modules: state.modules.map((module) => ({ ...module, content: exportedContent(module.content, options) })),
  });
}
