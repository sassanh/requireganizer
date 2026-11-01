import { cast, getSnapshot, getType, type Instance, types } from "mobx-state-tree";

import { UserFacingError } from "lib/errors";
import { codesMatch, formatCode } from "lib/fragmentCodes";
import { uuid } from "utilities";

import { cachedView, keyedView } from "./cachedViews";
import { type FieldDefinition, itemsFields, type ModuleReader, placedFields, type ReadItem, type ShownParts, type Workflow } from "./definition";
import { fingerprint } from "./hash";
import {
  chosenItems,
  type CoverageSignature,
  type FieldValue,
  type ImpactSignature,
  type ItemContent,
  type ItemSignature,
  type ItemVersion,
  type RecordContent,
  recordsValue,
  recordValue,
  type Removal,
  removalRevision,
  removedRevision,
  revisionOf,
  type SignatureRecord,
  type Signer,
  SPEC_OWNER,
  textsValue,
  textValue,
} from "./records";
import {
  type Thread,
  type ThreadAnswer,
  type ThreadAuthor,
  type ThreadInHand,
  threadTurn,
  waitsForAnswerer,
  waitsForSpecOwner,
} from "./threads";
import {
  coverageUnitId,
  impactUnitId,
  type ItemPhase,
  type LinkReason,
  type NotApprovedReason,
  parseUnitId,
  type StageProgress,
  type WaitingCategory,
} from "./units";

export const ItemModel = types.model("Item", {
  id: types.identifier,
  kind: types.string,
  content: types.frozen<ItemContent>(),
  /** Items of a basis stage of this item's stage, by id. */
  references: types.array(types.string),
  /** Items of this item's stage, or of another module, by id. */
  dependencies: types.array(types.string),
  /** The revision of each item it references or depends on, as it was last written or signed against. */
  basis: types.optional(types.frozen<Record<string, string>>(), {}),
  /** The last signature on the item; it counts only while it covers the item's current version. */
  signature: types.optional(types.maybeNull(types.frozen<ItemSignature>()), null),
  removal: types.optional(types.maybeNull(types.frozen<Removal>()), null),
});

export type Item = Instance<typeof ItemModel>;

export const StageModel = types.model("Stage", {
  items: types.array(ItemModel),
  /** The version of each item of the stages it builds on, as this stage last took it in. */
  intake: types.optional(types.frozen<Record<string, ItemVersion>>(), {}),
  /** The last signature on the coverage of each item it covers, by that item's id. */
  coverages: types.optional(types.frozen<Record<string, CoverageSignature>>(), {}),
  /** The last signature on the impact on each item it took in, by that item's id. */
  impacts: types.optional(types.frozen<Record<string, ImpactSignature>>(), {}),
});

export type Stage = Instance<typeof StageModel>;

/** Another module of the project, as this one resolves dependencies on its items. */
export interface ModuleLookup {
  locateItem(id: string): { version: ItemVersion; stage: string; phase: ItemPhase } | null;
  itemStanding(id: string): { approved: boolean; outOfDate: boolean } | null;
  codeOf(id: string): string | null;
  /** The item a code or id names in that module. */
  itemNamed(name: string): string | null;
  /** Every item of that module not yet removed, with its code and stage. */
  listItems(): { id: string; code: string; stage: string }[];
  /** The items an item of that module depends on, or none for an item it does not hold. */
  dependenciesOf(id: string): readonly string[];
  /** The items of that module out of date because of an item of another module. */
  outOfDateBecauseOf(id: string): string[];
}

export interface LinkedModule {
  id: string;
  name: string;
  lookup: ModuleLookup;
}

/** An item an out-of-date item references or depends on, and why it makes it out of date. */
export interface OutOfDateCause {
  id: string;
  /** The other module's name, for an item of another module. */
  module: string | null;
  reasons: LinkReason[];
}

interface UnitStateBase {
  unitId: string;
  stage: string;
  approved: boolean;
  /** Every reason the unit is not approved; empty once approved. */
  reasons: NotApprovedReason[];
  signatureCounts: boolean;
  openThread: Thread | null;
}

export interface ItemState extends UnitStateBase {
  kind: "item";
  itemId: string;
  itemKind: string;
  code: string;
  phase: ItemPhase;
  version: ItemVersion;
  revision: string;
  signature: ItemSignature | null;
  /** The revision of each item it references or depends on now. */
  currentBasis: Record<string, string>;
  outOfDateCauses: OutOfDateCause[];
  outOfDate: boolean;
  /** What it waits for a signature as, or null when it does not wait for one. */
  waiting: WaitingCategory | null;
}

export interface CoverageState extends UnitStateBase {
  kind: "coverage";
  itemId: string;
  covers: string;
  referencing: string[];
  signature: CoverageSignature | null;
}

export interface ImpactState extends UnitStateBase {
  kind: "impact";
  itemId: string;
  covers: string;
  /** The item as the stage last took it in. */
  before: ItemVersion;
  /** The item as it is now, or null once removed. */
  after: ItemVersion | null;
  signature: ImpactSignature | null;
}

export type UnitState = ItemState | CoverageState | ImpactState;

export interface StageSummary {
  stage: string;
  open: boolean;
  progress: StageProgress;
  approved: number;
  total: number;
  waiting: Record<WaitingCategory, number> & { coverages: number; impacts: number };
  threadsWaitingForSpecOwner: number;
}

/** One change a writer makes to the spec: an item added, changed or removed. */
export type ItemChange =
  | {
      type: "add";
      stage: string;
      kind: string;
      content: ItemContent;
      references: string[];
      dependencies: string[];
    }
  | {
      type: "change";
      item: string;
      content?: Partial<ItemContent>;
      references?: string[];
      dependencies?: string[];
    }
  | { type: "remove"; item: string };

/** What a set of changes did, each item by id. */
export interface ChangeOutcome {
  added: string[];
  changed: string[];
  proposedForRemoval: string[];
  removalWithdrawn: string[];
  deleted: { id: string; label: string }[];
  unchanged: string[];
}

/** The revision a basis records for an item that no longer exists. */
const MISSING_REVISION = "missing";

function versionOf(item: Item): ItemVersion {
  return { content: item.content, references: [...item.references], dependencies: [...item.dependencies] };
}

function phaseOf(removal: Removal | null): ItemPhase {
  if (removal == null) return "active";
  return removal.signature == null ? "proposed-removal" : "removed";
}

function sameBasis(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(right);
  return Object.keys(left).length === keys.length && keys.every((key) => left[key] === right[key]);
}

function signatureRecord(signer: Signer, covers: string): SignatureRecord {
  return { signer, at: new Date().toISOString(), covers };
}

/** Whether a value says nothing: no text, no, no entry, or a record whose every field says nothing. */
function isEmptyValue(value: FieldValue | undefined): boolean {
  if (value == null || value === false) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return Object.values(value as RecordContent).every(isEmptyValue);
}

/** A record's content as stored: every field, text trimmed, an empty text or choice as null, and a record saying nothing as null. */
function normalizedRecord(fields: readonly FieldDefinition[], content: RecordContent): RecordContent {
  return Object.fromEntries(
    fields.map((field): [string, FieldValue] => {
      const value = content[field.name] ?? null;
      switch (field.type) {
        case "items":
          return [field.name, [...chosenItems(value)]];
        case "texts":
          return [field.name, textsValue(value).map((entry) => entry.trim())];
        case "flag":
          return [field.name, value === true];
        case "record": {
          const record = recordValue(value);
          return [field.name, record == null || isEmptyValue(record) ? null : normalizedRecord(field.fields, record)];
        }
        case "records":
          return [field.name, recordsValue(value).map((record) => normalizedRecord(field.fields, record))];
        case "text":
        case "choice": {
          const text = textValue(value).trim();
          return [field.name, text === "" ? null : text];
        }
      }
    }),
  );
}

/** A place in an item, as a problem names it: ", Given step 2, input 1", or "" at the top. */
function placeLabel(path: readonly { entry: string; index: number }[]): string {
  return path.map(({ entry, index }) => `, ${entry} ${index + 1}`).join("");
}

/**
 * The model of one module's spec under a workflow: its stages' items, the
 * signatures on them, and the threads on them. Every state the workflow
 * asks about, such as approval, out of date, coverage, impact and
 * completion, is derived here and only here.
 */
export function workflowModuleModel(workflow: Workflow) {
  return types
    .model("WorkflowModule", {
      stages: types.optional(types.map(StageModel), {}),
      threads: types.optional(types.frozen<Thread[]>(), []),
    })
    .volatile(() => ({
      /** The project's other modules, which dependencies may name. */
      linkedModules: [] as LinkedModule[],
      /** The thread turns an answerer is at work on now. */
      threadsInHand: [] as ThreadInHand[],
    }))
    .views((self) => {
      const itemsOf = (stage: string): readonly Item[] => self.stages.get(stage)?.items ?? [];

      const index = cachedView(() => {
        const map = new Map<string, { item: Item; stage: string }>();
        for (const stage of workflow.stageIds) {
          for (const item of itemsOf(stage)) map.set(item.id, { item, stage });
        }
        return map;
      });

      const locate = (id: string) => index().get(id) ?? null;

      const revisionById = keyedView((id: string): string | null => {
        const located = locate(id);
        return located == null ? null : revisionOf(versionOf(located.item));
      });

      const codeById = keyedView((id: string): string | null => {
        const located = locate(id);
        if (located == null) return null;
        const definition = workflow.kind(located.item.kind);
        if (definition.single) return definition.code;
        const sameKind = itemsOf(located.stage).filter(({ kind }) => kind === located.item.kind);
        return formatCode(definition.code, sameKind.indexOf(located.item) + 1, sameKind.length);
      });

      /** An item this module's items may link to: its own, or another module's for a dependency. */
      function findLinked(id: string): { version: ItemVersion; stage: string; phase: ItemPhase; module: LinkedModule | null } | null {
        const own = locate(id);
        if (own != null) return { version: versionOf(own.item), stage: own.stage, phase: phaseOf(own.item.removal), module: null };
        for (const linked of self.linkedModules) {
          const found = linked.lookup.locateItem(id);
          if (found != null) return { ...found, module: linked };
        }
        return null;
      }

      const threadsOfUnit = cachedView(() => {
        const map = new Map<string, Thread[]>();
        for (const thread of self.threads) map.set(thread.unitId, [...(map.get(thread.unitId) ?? []), thread]);
        return map;
      });

      function openThreadOf(unitId: string): Thread | null {
        return threadsOfUnit().get(unitId)?.find(({ resolvedAt }) => resolvedAt == null) ?? null;
      }

      function referencesOf(item: Item): string[] {
        return workflow.referencesOf(item.kind, item);
      }

      /** The items of its own stage an item counts as depending on without listing them: those its fields choose, and the items of single kinds it depends on. */
      function derivedDependenciesOf(kind: string, content: ItemContent, stage: string, itemId: string | null): string[] {
        const singles = workflow.kind(kind).dependsOnSingle ?? [];
        const single = itemsOf(stage).filter((candidate) => singles.includes(candidate.kind)).map(({ id }) => id);
        return [...new Set([...workflow.chosenDependencies(kind, content), ...single])].filter((id) => id !== itemId);
      }

      /** Every item an item depends on: those it counts as depending on, then those it lists, each once. */
      function dependenciesOf(item: Item): string[] {
        const stage = index().get(item.id)?.stage;
        const derived = stage == null ? [] : derivedDependenciesOf(item.kind, item.content, stage, item.id);
        return [...new Set([...derived, ...item.dependencies])];
      }

      function linksOf(item: Item): string[] {
        return [...new Set([...referencesOf(item), ...dependenciesOf(item)])];
      }

      function currentBasisOf(item: Item): Record<string, string> {
        return Object.fromEntries(
          linksOf(item).map((id) => {
            const linked = findLinked(id);
            return [id, linked == null ? MISSING_REVISION : revisionOf(linked.version)];
          }),
        );
      }

      function finish<State extends UnitStateBase>(state: Omit<State, "approved">): State {
        return { ...state, approved: state.reasons.length === 0 } as State;
      }

      const itemState = keyedView((id: string): ItemState | null => {
        const located = locate(id);
        if (located == null) return null;
        const { item, stage } = located;
        const version = versionOf(item);
        const revision = revisionById(id)!;
        const phase = phaseOf(item.removal);
        const signatureCounts = item.signature?.covers === revision;
        const outOfDateCauses: OutOfDateCause[] = [];
        for (const linkId of linksOf(item)) {
          const linked = findLinked(linkId);
          const reasons: LinkReason[] = [];
          if (linked == null || linked.phase === "removed") {
            reasons.push("removed");
          } else {
            if (item.basis[linkId] !== revisionOf(linked.version)) reasons.push("changed");
            const standing = linked.module == null ? itemStanding(linkId) : linked.module.lookup.itemStanding(linkId);
            if (standing?.outOfDate === true) reasons.push("out-of-date");
            else if (standing?.approved !== true) reasons.push("not-approved");
          }
          if (reasons.length > 0) outOfDateCauses.push({ id: linkId, module: linked?.module?.name ?? null, reasons });
        }
        const outOfDate = outOfDateCauses.length > 0;
        const openThread = openThreadOf(id);
        const reasons: NotApprovedReason[] = [];
        if (phase !== "removed") {
          if (!signatureCounts) reasons.push("no-signature");
          if (openThread != null) reasons.push("open-thread");
          if (outOfDate) reasons.push("out-of-date");
          if (phase === "proposed-removal") reasons.push("proposed-removal");
        }
        const currentBasis = currentBasisOf(item);
        const waiting: WaitingCategory | null =
          phase === "proposed-removal"
            ? "proposed-removal"
            : phase === "removed"
              ? null
              : item.signature == null
                ? "new"
                : !signatureCounts
                  ? "changed"
                  : outOfDate && !sameBasis(item.basis, currentBasis)
                    ? "out-of-date"
                    : null;
        return finish<ItemState>({
          kind: "item",
          unitId: id,
          itemId: id,
          itemKind: item.kind,
          stage,
          code: codeById(id)!,
          phase,
          version,
          revision,
          signature: item.signature,
          signatureCounts,
          currentBasis,
          outOfDateCauses,
          outOfDate,
          openThread,
          reasons: phase === "removed" ? ["proposed-removal"] : reasons,
          waiting,
        });
      });

      function itemStanding(id: string): { approved: boolean; outOfDate: boolean } | null {
        const state = itemState(id);
        return state == null ? null : { approved: state.approved, outOfDate: state.outOfDate };
      }

      /** The items of a stage that count toward it: everything not yet removed. */
      const countedItems = keyedView((stage: string): Item[] =>
        itemsOf(stage).filter(({ removal }) => phaseOf(removal) !== "removed"),
      );

      const activeItems = keyedView((stage: string): Item[] =>
        itemsOf(stage).filter(({ removal }) => removal == null),
      );

      const coverageStates = keyedView((stage: string): CoverageState[] => {
        const referencingIndex = new Map<string, Item[]>();
        for (const item of activeItems(stage)) {
          for (const reference of referencesOf(item)) {
            referencingIndex.set(reference, [...(referencingIndex.get(reference) ?? []), item]);
          }
        }
        const stored = self.stages.get(stage)?.coverages ?? {};
        return workflow.stage(stage).buildsOn.flatMap(({ stage: basis, covers }) =>
          activeItems(basis)
            .filter(({ kind }) => covers.includes(kind))
            .map((covered) => {
              const referencing = [...(referencingIndex.get(covered.id) ?? [])].sort((left, right) => left.id.localeCompare(right.id));
              const checked = fingerprint({
                item: [covered.id, revisionById(covered.id)],
                referencing: referencing.map(({ id }) => [id, revisionById(id)]),
              });
              const unitId = coverageUnitId(stage, covered.id);
              const signature = stored[covered.id] ?? null;
              const signatureCounts = signature?.covers === checked;
              const openThread = openThreadOf(unitId);
              const reasons: NotApprovedReason[] = [];
              if (!signatureCounts) reasons.push("no-signature");
              if (openThread != null) reasons.push("open-thread");
              return finish<CoverageState>({
                kind: "coverage",
                unitId,
                stage,
                itemId: covered.id,
                covers: checked,
                referencing: referencing.map(({ id }) => id),
                signature,
                signatureCounts,
                openThread,
                reasons,
              });
            }),
        );
      });

      const impactStates = keyedView((stage: string): ImpactState[] => {
        const stored = self.stages.get(stage);
        const intake = stored?.intake ?? {};
        const signatures = stored?.impacts ?? {};
        const asked = new Map<string, ItemVersion | null>();
        for (const [id, taken] of Object.entries(intake)) {
          const located = locate(id);
          if (located == null || phaseOf(located.item.removal) === "removed") {
            asked.set(id, taken);
          } else if (revisionById(id) !== revisionOf(taken)) {
            asked.set(id, taken);
          }
        }
        // A signed impact stays while a thread on it is open, so the thread keeps it from counting as approved.
        for (const thread of self.threads) {
          if (thread.resolvedAt != null || thread.stage !== stage) continue;
          const address = parseUnitId(thread.unitId);
          if (address.kind !== "impact" || asked.has(address.itemId)) continue;
          if (signatures[address.itemId] == null) continue;
          asked.set(address.itemId, null);
        }
        return [...asked.entries()].map(([id, taken]) => {
          const located = locate(id);
          const present = located != null && phaseOf(located.item.removal) !== "removed";
          const after = present ? versionOf(located.item) : null;
          const covers = present ? revisionById(id)! : removedRevision(id);
          const unitId = impactUnitId(stage, id);
          const signature = signatures[id] ?? null;
          const signatureCounts = signature?.covers === covers;
          const openThread = openThreadOf(unitId);
          const reasons: NotApprovedReason[] = [];
          if (!signatureCounts) reasons.push("no-signature");
          if (openThread != null) reasons.push("open-thread");
          return finish<ImpactState>({
            kind: "impact",
            unitId,
            stage,
            itemId: id,
            covers,
            before: taken ?? signature!.before,
            after,
            signature,
            signatureCounts,
            openThread,
            reasons,
          });
        });
      });

      /** Every unit a stage asks for: its items not yet removed, its coverages and its impacts. */
      const stageUnits = keyedView((stage: string): UnitState[] => [
        ...countedItems(stage).map(({ id }) => itemState(id)!),
        ...coverageStates(stage),
        ...impactStates(stage),
      ]);

      const stageComplete = keyedView((stage: string): boolean =>
        countedItems(stage).length > 0 && stageUnits(stage).every(({ approved }) => approved),
      );

      const stageOpen = keyedView((stage: string): boolean =>
        workflow.upstreamStages(stage).every((upstream) => stageComplete(upstream)),
      );

      function unitState(unitId: string): UnitState | null {
        const address = parseUnitId(unitId);
        switch (address.kind) {
          case "item":
            return itemState(address.itemId);
          case "coverage":
            return workflow.isStage(address.stage)
              ? coverageStates(address.stage).find(({ itemId }) => itemId === address.itemId) ?? null
              : null;
          case "impact":
            return workflow.isStage(address.stage)
              ? impactStates(address.stage).find(({ itemId }) => itemId === address.itemId) ?? null
              : null;
        }
      }

      /** Whether the spec owner can sign the unit now. */
      function isSignable(unitId: string): boolean {
        const state = unitState(unitId);
        if (state == null || !stageOpen(state.stage)) return false;
        switch (state.kind) {
          case "item":
            if (state.phase === "proposed-removal") return true;
            if (state.phase === "removed") return false;
            return !state.signatureCounts || !sameBasis(locate(state.itemId)!.item.basis, state.currentBasis);
          case "coverage":
          case "impact":
            return !state.signatureCounts;
        }
      }

      /** The module as a kind's rules and displays read it. */
      const reader: ModuleReader = {
        item: (id) => {
          const located = locate(id);
          return located == null ? null : readItem(located.item);
        },
        itemsOf: (kind) => {
          if (!workflow.isKind(kind)) return [];
          return itemsOf(workflow.stageOfKind(kind)).filter((item) => item.kind === kind && item.removal == null).map(readItem);
        },
      };

      function readItem(item: Item): ReadItem {
        return {
          id: item.id,
          kind: item.kind,
          code: codeById(item.id)!,
          content: item.content,
          references: referencesOf(item),
          get text() {
            return shownText(item.kind, item.content);
          },
        };
      }

      function shownParts(kind: string, content: ItemContent): ShownParts {
        const definition = workflow.kind(kind);
        const field = (name: string) => definition.fields.find((candidate) => candidate.name === name);
        return {
          content,
          module: reader,
          text: (name) => textValue(content[name]),
          names: (name) => {
            const chosen = field(name);
            return chosenItems(content[name]).map((id) => {
              const located = locate(id);
              if (located == null) return "a removed item";
              const shown = chosen?.type === "items" ? textValue(located.item.content[chosen.shows]) : "";
              return shown === "" ? codeById(id)! : shown;
            });
          },
        };
      }

      /** An item's content as every view of it shows it, each chosen item named by its shown field. */
      function shownText(kind: string, content: ItemContent): string {
        return workflow.kind(kind).display(shownParts(kind, content));
      }

      /** The marks an item's content shows beside it. */
      function marksOf(kind: string, content: ItemContent): string[] {
        return workflow.kind(kind).marks?.(shownParts(kind, content)) ?? [];
      }

      return {
        itemsOf,
        locate,
        findLinked,
        referencesOf,
        dependenciesOf,
        derivedDependenciesOf,
        /** The module as a kind's rules and displays read it. */
        get reader(): ModuleReader {
          return reader;
        },
        shownText,
        marksOf,
        /** An item's text as it is now. */
        textOf(id: string): string {
          const located = locate(id);
          return located == null ? "" : shownText(located.item.kind, located.item.content);
        },
        codeOf: (id: string) => codeById(id),
        revisionOf: (id: string) => revisionById(id),
        versionOf: (id: string): ItemVersion | null => {
          const located = locate(id);
          return located == null ? null : versionOf(located.item);
        },
        itemState,
        itemStanding,
        coverageStates,
        impactStates,
        stageUnits,
        stageComplete,
        stageOpen,
        unitState,
        isSignable,
        openThreadOf,
        currentBasisOf,
        /** Every thread on a unit, oldest first. */
        threadsOf(unitId: string): Thread[] {
          return threadsOfUnit().get(unitId) ?? [];
        },
        /** Every item of the module, in stage order. */
        get allItems(): Item[] {
          return workflow.stageIds.flatMap((stage) => [...itemsOf(stage)]);
        },
      };
    })
    .views((self) => {
      const waitsForSignature = (unit: UnitState): boolean =>
        unit.kind === "item" ? unit.waiting != null : !unit.signatureCounts;

      const progress = (stage: string): StageProgress => {
        const counted = self.stageUnits(stage).filter(({ kind }) => kind === "item");
        if (counted.length === 0) return "empty";
        return self.stageComplete(stage) ? "complete" : "in-progress";
      };

      /** The items of this module out of date because of `id`, which may be of another module. */
      const outOfDateBecauseOf = keyedView((id: string): string[] =>
        self.allItems
          .filter((item) => self.itemState(item.id)?.outOfDateCauses.some((cause) => cause.id === id) === true)
          .map(({ id: dependent }) => dependent),
      );

      /** A unit as the page names it: an item by its code, a coverage or an impact by the item it is on. */
      function unitLabel(unitId: string): string {
        const address = parseUnitId(unitId);
        const itemName = self.codeOf(address.itemId) ?? self.threads.find((thread) => thread.unitId === unitId)?.removedUnit ?? "a removed item";
        switch (address.kind) {
          case "item":
            return itemName;
          case "coverage":
            return `coverage of ${itemName}`;
          case "impact":
            return `impact of ${itemName}`;
        }
      }

      /** The item a code or id names in this module, if any. */
      function itemNamed(name: string): string | null {
        if (self.locate(name) != null) return name;
        return self.allItems.find(({ id }) => {
          const code = self.codeOf(id)!;
          return code === name || codesMatch(name, code);
        })?.id ?? null;
      }

      return {
        stageProgress: progress,
        outOfDateBecauseOf,
        unitLabel,
        itemNamed,
        /** Every item of this module or another that references or depends on `id` and is out of date because of it. */
        dependentsOutOfDate(id: string): { id: string; module: string | null; code: string }[] {
          return [
            ...outOfDateBecauseOf(id).map((dependent) => ({ id: dependent, module: null, code: self.codeOf(dependent)! })),
            ...self.linkedModules.flatMap((module) =>
              module.lookup.outOfDateBecauseOf(id).map((dependent) => ({
                id: dependent,
                module: module.name,
                code: module.lookup.codeOf(dependent) ?? dependent,
              })),
            ),
          ];
        },
        /** The stages that build on this item's stage and cover its kind, where no item references it. */
        stagesNotReferencing(id: string): string[] {
          const located = self.locate(id);
          if (located == null || located.item.removal != null) return [];
          return workflow
            .coveringStages(located.item.kind)
            .filter((stage) => self.coverageStates(stage).find(({ itemId }) => itemId === id)?.referencing.length === 0);
        },
        /** Whether the unit still waits for a signature, as each stage counts it. */
        waitsForSignature,
        stageSummary(stage: string): StageSummary {
          const units = self.stageUnits(stage);
          const waiting = { new: 0, changed: 0, "out-of-date": 0, "proposed-removal": 0, coverages: 0, impacts: 0 };
          for (const unit of units) {
            if (!waitsForSignature(unit)) continue;
            if (unit.kind === "item") waiting[unit.waiting!] += 1;
            else waiting[unit.kind === "coverage" ? "coverages" : "impacts"] += 1;
          }
          return {
            stage,
            open: self.stageOpen(stage),
            progress: progress(stage),
            approved: units.filter(({ approved }) => approved).length,
            total: units.length,
            waiting,
            threadsWaitingForSpecOwner: self.threads.filter((thread) => thread.stage === stage && waitsForSpecOwner(thread)).length,
          };
        },
        /** Whether every stage of the module is complete. */
        get isComplete(): boolean {
          return workflow.stageIds.every((stage) => self.stageComplete(stage));
        },
        /** Changes whenever a code may come to name another item. */
        get codesVersion(): string {
          return fingerprint(workflow.stageIds.map((stage) => self.itemsOf(stage).map(({ id }) => id))).slice(0, 12);
        },
        /** The stage's threads, open and resolved, oldest first, including those whose unit is gone. */
        threadsOfStage(stage: string): Thread[] {
          return self.threads.filter((thread) => thread.stage === stage);
        },
        /** The open threads that wait for the coding agent in stages open now. */
        get threadsWaitingForAnswerer(): Thread[] {
          return self.threads.filter((thread) => waitsForAnswerer(thread) && self.stageOpen(thread.stage));
        },
        /** An answerer is at work on the thread's turn now. */
        isBeingAnswered(threadId: string): boolean {
          const thread = self.threads.find(({ id }) => id === threadId);
          if (thread == null || !waitsForAnswerer(thread)) return false;
          const turn = threadTurn(thread);
          return self.threadsInHand.some((inHand) => inHand.turn === turn);
        },
        /** This module as another module resolves dependencies on it. */
        get lookup(): ModuleLookup {
          return {
            locateItem: (id) => {
              const located = self.locate(id);
              return located == null
                ? null
                : { version: self.versionOf(id)!, stage: located.stage, phase: phaseOf(located.item.removal) };
            },
            itemStanding: (id) => self.itemStanding(id),
            codeOf: (id) => self.codeOf(id),
            itemNamed,
            dependenciesOf: (id) => {
              const located = self.locate(id);
              return located == null ? [] : self.dependenciesOf(located.item);
            },
            listItems: () =>
              self.allItems
                .filter(({ removal }) => phaseOf(removal) !== "removed")
                .map(({ id }) => ({ id, code: self.codeOf(id)!, stage: self.locate(id)!.stage })),
            outOfDateBecauseOf: (id) => outOfDateBecauseOf(id),
          };
        },
      };
    })
    .views((self) => ({
      /** Why the answers cannot be given now, or null. */
      answerProblem(answers: readonly ThreadAnswer[]): string | null {
        for (const { threadId, text } of answers) {
          const thread = self.threads.find(({ id }) => id === threadId);
          if (thread == null) return `There is no thread ${threadId}. Read the open threads with get_workflow_state.`;
          if (thread.resolvedAt != null) return `The spec owner resolved thread ${threadId}.`;
          if (!self.stageOpen(thread.stage)) {
            return `Thread ${threadId} is in ${workflow.stage(thread.stage).label}, which is closed until the stages it builds on are complete.`;
          }
          if (text.trim().length === 0) return `The reply to thread ${threadId} is empty.`;
        }
        return null;
      },
      /** Why the changes cannot be made, one line per problem; empty when they can. */
      dependencyProblems(ids: readonly string[]): string[] {
        const problems: string[] = [];
        // Dependencies may cross modules, so a cycle is followed through every module of the project.
        const dependenciesOf = (id: string): readonly string[] => {
          const own = self.locate(id);
          if (own != null) return self.dependenciesOf(own.item);
          return self.linkedModules.map((linked) => linked.lookup.dependenciesOf(id)).find((found) => found.length > 0) ?? [];
        };
        for (const id of ids) {
          const located = self.locate(id);
          if (located == null) continue;
          const name = self.codeOf(id)!;
          for (const dependency of located.item.dependencies) {
            if (dependency === id) {
              problems.push(`${name} depends on itself.`);
              continue;
            }
            const linked = self.findLinked(dependency);
            if (linked == null || linked.phase === "removed") {
              problems.push(`${name} depends on ${dependency}, which is not an item of this project.`);
              continue;
            }
            if (linked.module == null) {
              if (linked.stage !== located.stage) {
                problems.push(`${name} depends on ${self.codeOf(dependency)}, which is in another stage; it may depend only on items of its own stage or of another module.`);
              }
            } else if (linked.stage !== located.stage && !workflow.buildsOn(located.stage, linked.stage)) {
              problems.push(`${name} depends on ${linked.module.name}'s ${linked.module.lookup.codeOf(dependency)}, whose stage is neither ${name}'s nor one it builds on.`);
            }
          }
          // Only dependencies can form a cycle; references always point to earlier stages.
          const seen = new Set<string>();
          const reaches = (from: string): boolean => {
            for (const next of dependenciesOf(from)) {
              if (next === id) return true;
              if (seen.has(next)) continue;
              seen.add(next);
              if (reaches(next)) return true;
            }
            return false;
          };
          if (reaches(id)) problems.push(`${name}'s dependencies form a cycle.`);
        }
        return problems;
      },
      /**
       * The problems of items as written, by the rules of their kinds: a
       * value a field does not offer where it sits, and the kind's own check.
       * Checked once a whole set of changes is applied, so no order of the
       * changes matters.
       */
      kindProblems(ids: readonly string[]): string[] {
        return ids.flatMap((id) => {
          const located = self.locate(id);
          if (located == null) return [];
          const { item } = located;
          const definition = workflow.kind(item.kind);
          const name = self.codeOf(id)!;
          const problems: string[] = [];
          for (const placed of placedFields(definition.fields, item.content)) {
            const { field } = placed;
            if (!("offered" in field) || field.offered == null) continue;
            const chosen = field.type === "items" ? chosenItems(placed.value) : textValue(placed.value) === "" ? [] : [textValue(placed.value)];
            if (chosen.length === 0) continue;
            const offer = field.offered({ content: item.content, path: placed.path, record: placed.record, module: self.reader });
            for (const value of chosen) {
              if (offer.values.includes(value)) continue;
              const shown = field.type === "items" ? self.codeOf(value) ?? value : `"${value}"`;
              problems.push(`${name}${placeLabel(placed.path)}: ${field.label} cannot be ${shown}: ${offer.rule}`);
            }
          }
          problems.push(...(definition.check?.(item.content, self.reader, id) ?? []).map((problem) => `${name}: ${problem}`));
          return problems;
        });
      },
    }))
    .actions((self) => {
      function stageNode(stage: string): Stage {
        let node = self.stages.get(stage);
        if (node == null) {
          self.stages.set(stage, {});
          node = self.stages.get(stage)!;
        }
        return node;
      }

      function requireOpen(stage: string, doing: string): void {
        if (!self.stageOpen(stage)) {
          const waitingFor = workflow
            .upstreamStages(stage)
            .filter((upstream) => !self.stageComplete(upstream))
            .map((upstream) => workflow.stage(upstream).label);
          throw new UserFacingError(
            `${workflow.stage(stage).label} is closed to ${doing} until ${waitingFor.join(" and ")} ${waitingFor.length === 1 ? "is" : "are"} complete.`,
          );
        }
      }

      /** A write takes in every item of the stages it builds on that the stage has not taken in yet. */
      function takeIn(stage: string): void {
        const node = stageNode(stage);
        const intake = { ...node.intake };
        let changed = false;
        for (const upstream of workflow.upstreamStages(stage)) {
          for (const item of self.itemsOf(upstream)) {
            if (item.removal != null || intake[item.id] != null) continue;
            intake[item.id] = self.versionOf(item.id)!;
            changed = true;
          }
        }
        if (changed) node.intake = intake;
      }

      function markThreadsRemoved(unitIds: ReadonlySet<string>): void {
        if (!self.threads.some(({ unitId }) => unitIds.has(unitId))) return;
        self.threads = self.threads.map((thread) =>
          unitIds.has(thread.unitId) && thread.removedUnit == null ? { ...thread, removedUnit: self.unitLabel(thread.unitId) } : thread,
        );
      }

      /** Delete an item from its stage, keeping its threads readable from the stage. */
      function deleteItem(id: string): string {
        const located = self.locate(id)!;
        const label = self.codeOf(id)!;
        const unitIds = new Set([id]);
        for (const stage of workflow.stageIds) {
          unitIds.add(coverageUnitId(stage, id));
          unitIds.add(impactUnitId(stage, id));
        }
        markThreadsRemoved(unitIds);
        for (const stage of workflow.stageIds) {
          const node = self.stages.get(stage);
          if (node == null) continue;
          if (node.coverages[id] != null) {
            const { [id]: _dropped, ...rest } = node.coverages;
            node.coverages = rest;
          }
        }
        stageNode(located.stage).items.remove(located.item);
        return label;
      }

      /** An item whose removal is signed leaves its stage once no stage still asks for an impact on its removal. */
      function deleteIfSettled(id: string): { id: string; label: string } | null {
        const located = self.locate(id);
        if (located == null || phaseOf(located.item.removal) !== "removed") return null;
        if (workflow.stageIds.some((stage) => self.stages.get(stage)?.intake[id] != null)) return null;
        return { id, label: deleteItem(id) };
      }

      /** A record's problems against its fields: unknown fields, values of the wrong shape, required fields left empty, a choice outside its options. */
      function shapeProblems(fields: readonly FieldDefinition[], content: RecordContent, name: string, entry: string): string[] {
        const problems: string[] = [];
        const known = new Set(fields.map((field) => field.name));
        for (const key of Object.keys(content)) {
          if (!known.has(key)) problems.push(`${name}: ${entry} has no field ${key}; it has ${[...known].join(", ")}.`);
        }
        for (const field of fields) {
          const value = content[field.name] ?? null;
          const label = `${name}: ${field.label}`;
          const isTexts = Array.isArray(value) && value.every((part) => typeof part === "string");
          switch (field.type) {
            case "items": {
              const chosenKind = workflow.kind(field.of);
              if (value != null && !isTexts) problems.push(`${label} must be a list of ${chosenKind.plural.toLowerCase()}.`);
              else if (field.required && chosenItems(value).length === 0) problems.push(`${name} is missing ${field.label}: choose ${field.single ? "one" : "at least one"} ${chosenKind.label.toLowerCase()}.`);
              else if (field.single && chosenItems(value).length > 1) problems.push(`${label} chooses one ${chosenKind.label.toLowerCase()} only.`);
              break;
            }
            case "texts":
              if (value != null && !isTexts) problems.push(`${label} must be a list of texts.`);
              else if (textsValue(value).some((part) => part.trim().length === 0)) problems.push(`${label} has an empty entry.`);
              else if (field.required && textsValue(value).length === 0) problems.push(`${name} is missing ${field.label}: give at least one.`);
              break;
            case "flag":
              if (value != null && typeof value !== "boolean") problems.push(`${label} must be true or false.`);
              break;
            case "record": {
              const record = recordValue(value);
              if (value != null && (record == null || typeof value !== "object")) problems.push(`${label} must be an object of its fields.`);
              else if (record == null || isEmptyValue(record)) {
                if (field.required) problems.push(`${name} is missing ${field.label}.`);
              } else problems.push(...shapeProblems(field.fields, record, `${name}, ${field.label.toLowerCase()}`, field.label.toLowerCase()));
              break;
            }
            case "records": {
              const records = recordsValue(value);
              if (value != null && (!Array.isArray(value) || records.length !== value.length)) problems.push(`${label} must be a list of objects, one per ${field.entry}.`);
              else if (field.required && records.length === 0) problems.push(`${name} is missing ${field.label}: give at least one ${field.entry}.`);
              else records.forEach((record, index) => problems.push(...shapeProblems(field.fields, record, `${name}, ${field.entry} ${index + 1}`, `a ${field.entry}`)));
              break;
            }
            case "text":
            case "choice":
              if (value != null && typeof value !== "string") problems.push(`${label} must be text.`);
              else if (textValue(value).trim().length === 0) {
                if (field.required) problems.push(`${name} is missing ${field.label}.`);
              } else if (field.type === "choice" && !field.options.includes(textValue(value).trim())) {
                problems.push(`${label} must be one of ${field.options.join(", ")}.`);
              }
              break;
          }
        }
        return problems;
      }

      function contentProblems(kind: string, content: ItemContent, name: string): string[] {
        return shapeProblems(workflow.kind(kind).fields, content, name, `a ${workflow.kind(kind).label.toLowerCase()}`);
      }

      /** The content as stored: every field of its kind, at any depth. */
      function normalizedContent(kind: string, content: ItemContent): ItemContent {
        return normalizedRecord(workflow.kind(kind).fields, content);
      }

      /**
       * The problems of an item's links: the items its fields choose, its
       * references and its dependencies. A link it did not hold before must
       * name an item that is not removed; `before` lists those it held.
       */
      function linkProblems(
        stage: string,
        kind: string,
        content: ItemContent,
        references: readonly string[],
        dependencies: readonly string[],
        before: ReadonlySet<string>,
        itemId: string | null,
        name: string,
      ): string[] {
        const problems: string[] = [];
        const definition = workflow.kind(kind);
        const basis = workflow.basisStages(stage);
        const chosenKinds = workflow.chosenKinds(kind);
        const check = (reference: string, expectedKind: string | null, label: string) => {
          const located = self.locate(reference);
          if (located == null) {
            if (!before.has(reference)) problems.push(`${label} names ${reference}, which is not an item of this module.`);
            return;
          }
          const code = self.codeOf(reference);
          if (expectedKind != null && located.item.kind !== expectedKind) {
            problems.push(`${label} chooses ${code}, but it is a ${workflow.kind(located.item.kind).label.toLowerCase()}, not a ${workflow.kind(expectedKind).label.toLowerCase()}.`);
          } else if (expectedKind == null && chosenKinds.includes(located.item.kind)) {
            const field = itemsFields(definition.fields).find((candidate) => candidate.of === located.item.kind)!;
            problems.push(`${name} lists ${code} in its references; a ${definition.label.toLowerCase()} names its ${workflow.kind(located.item.kind).plural.toLowerCase()} in ${field.label} instead, and counts as referencing them.`);
          }
          if (before.has(reference)) return;
          const allowed = expectedKind != null && workflow.stageOfKind(expectedKind) === stage ? [stage] : basis;
          if (!allowed.includes(located.stage)) {
            problems.push(
              allowed.length === 0
                ? `${name} cannot reference ${code}: ${workflow.stage(stage).label} builds on no stage.`
                : `${label} names ${code}, which is not in ${allowed.map((id) => workflow.stage(id).label).join(" or ")}.`,
            );
          } else if (located.item.removal != null) {
            problems.push(`${label} names ${code}, which is removed.`);
          }
        };
        for (const placed of placedFields(definition.fields, content)) {
          if (placed.field.type !== "items") continue;
          const label = `${name}${placeLabel(placed.path)}: ${placed.field.label}`;
          const chosen = chosenItems(placed.value);
          if (new Set(chosen).size !== chosen.length) problems.push(`${label} chooses an item twice.`);
          for (const reference of chosen) check(reference, placed.field.of, label);
        }
        if (new Set(references).size !== references.length) problems.push(`${name} references an item twice.`);
        for (const reference of references) check(reference, null, `${name}'s references`);
        const derived = new Set(self.derivedDependenciesOf(kind, content, stage, itemId));
        for (const dependency of dependencies) {
          if (derived.has(dependency)) {
            problems.push(`${name} lists ${self.codeOf(dependency)} in its dependencies; it counts as depending on it already, so leave it out.`);
          }
        }
        const all = workflow.referencesOf(kind, { content, references });
        for (const required of definition.mustReference ?? []) {
          const referenced = all.some((id) => {
            const located = self.locate(id);
            return located != null && located.item.kind === required && phaseOf(located.item.removal) !== "removed";
          });
          if (!referenced) {
            problems.push(`${name} references no ${workflow.kind(required).label.toLowerCase()} of this module; reference at least one.`);
          }
        }
        return problems;
      }

      /** Apply one change to this module, returning its problems; nothing is changed when there are any. */
      /** `single` says this is the only change written, so a new item is named on its own rather than by its place in the list. */
      function applyChange(change: ItemChange, outcome: ChangeOutcome, label: string, single: boolean): string[] {
        if (change.type === "add") {
          if (!workflow.isStage(change.stage)) return [`${label}: there is no stage ${change.stage}.`];
          const stage = workflow.stage(change.stage);
          if (!stage.kinds.some(({ kind }) => kind === change.kind)) {
            return [`${label}: ${stage.label} holds ${stage.kinds.map(({ kind }) => kind).join(", ")}, not ${change.kind}.`];
          }
          const definition = workflow.kind(change.kind);
          const name = single ? `The new ${definition.label.toLowerCase()}` : `${label} (a new ${definition.label.toLowerCase()})`;
          const shapeProblems = contentProblems(change.kind, change.content, name);
          if (shapeProblems.length > 0) return shapeProblems;
          const content = normalizedContent(change.kind, change.content);
          const problems = linkProblems(change.stage, change.kind, content, change.references, change.dependencies, new Set(), null, name);
          if (definition.single && self.itemsOf(change.stage).some(({ kind, removal }) => kind === change.kind && removal == null)) {
            problems.push(`${name}: ${stage.label} already has its ${definition.label.toLowerCase()}; change it instead.`);
          }
          if (!self.stageOpen(change.stage)) problems.push(`${name}: ${stage.label} is closed until the stages it builds on are complete.`);
          if (problems.length > 0) return problems;
          const item = ItemModel.create({
            id: uuid(),
            kind: change.kind,
            content,
            references: change.references,
            dependencies: change.dependencies,
          });
          stageNode(change.stage).items.push(item);
          const added = self.locate(item.id)!.item;
          added.basis = self.currentBasisOf(added);
          takeIn(change.stage);
          outcome.added.push(item.id);
          return [];
        }
        const located = self.locate(change.item);
        if (located == null) return [`${label}: there is no item ${change.item}.`];
        const { item, stage } = located;
        const name = self.codeOf(item.id)!;
        const phase = phaseOf(item.removal);
        if (!self.stageOpen(stage)) return [`${name} is in ${workflow.stage(stage).label}, which is closed until the stages it builds on are complete.`];
        if (phase === "removed") return [`${name} is removed.`];
        if (change.type === "remove") {
          if (phase === "proposed-removal") return [`${name} is already proposed for removal.`];
          if (item.signature == null) {
            const id = item.id;
            outcome.deleted.push({ id, label: deleteItem(id) });
            for (const node of self.stages.values()) {
              if (node.intake[id] == null) continue;
              const { [id]: _dropped, ...rest } = node.intake;
              node.intake = rest;
            }
            return [];
          }
          item.removal = { signature: null };
          outcome.proposedForRemoval.push(item.id);
          return [];
        }
        const merged = { ...item.content, ...(change.content ?? {}) } as ItemContent;
        const shapeProblems = contentProblems(item.kind, merged, name);
        if (shapeProblems.length > 0) return shapeProblems;
        const content = normalizedContent(item.kind, merged);
        const references = change.references ?? [...item.references];
        const dependencies = change.dependencies ?? [...item.dependencies];
        const problems = linkProblems(stage, item.kind, content, references, dependencies, new Set([...self.referencesOf(item), ...self.dependenciesOf(item)]), item.id, name);
        if (problems.length > 0) return problems;
        const before = self.revisionOf(item.id);
        const withdrawn = phase === "proposed-removal";
        if (withdrawn) {
          item.removal = null;
          outcome.removalWithdrawn.push(item.id);
        }
        if (revisionOf({ content, references, dependencies }) === before) {
          if (!withdrawn) outcome.unchanged.push(item.id);
          return [];
        }
        item.content = content;
        item.references = cast(references);
        item.dependencies = cast(dependencies);
        item.basis = self.currentBasisOf(item);
        takeIn(stage);
        outcome.changed.push(item.id);
        return [];
      }

      function applyAll(changes: readonly ItemChange[]): { outcome: ChangeOutcome; problems: string[] } {
        const outcome: ChangeOutcome = { added: [], changed: [], proposedForRemoval: [], removalWithdrawn: [], deleted: [], unchanged: [] };
        const problems = changes.flatMap((change, index) => applyChange(change, outcome, `Change ${index + 1}`, changes.length === 1));
        problems.push(...self.dependencyProblems([...outcome.added, ...outcome.changed]));
        if (problems.length === 0) problems.push(...self.kindProblems([...outcome.added, ...outcome.changed]));
        return { outcome, problems };
      }

      function addMessage(threadId: string, message: Thread["messages"][number]): void {
        self.threads = self.threads.map((thread) =>
          thread.id === threadId ? { ...thread, messages: [...thread.messages, message] } : thread,
        );
      }

      function openThread(threadId: string): Thread {
        const thread = self.threads.find(({ id }) => id === threadId);
        if (thread == null) throw new UserFacingError(`There is no thread ${threadId}.`);
        if (thread.resolvedAt != null) throw new UserFacingError(`Thread ${threadId} is resolved.`);
        return thread;
      }

      return {
        setLinkedModules(modules: LinkedModule[]) {
          self.linkedModules = modules;
        },
        /**
         * Write, change and remove items, all or none. Items are named by
         * id; an item written gets the current versions of what it links to
         * as its basis, and an item written exactly as it was is left as it
         * was. Throws every problem at once.
         */
        writeItems(changes: ItemChange[]): ChangeOutcome {
          const trial = getType(self).create(getSnapshot(self)) as unknown as {
            setLinkedModules(modules: LinkedModule[]): void;
            writeItemsUnchecked(changes: ItemChange[]): { outcome: ChangeOutcome; problems: string[] };
          };
          trial.setLinkedModules(self.linkedModules);
          const { problems } = trial.writeItemsUnchecked(changes);
          if (problems.length > 0) throw new UserFacingError(problems.join("\n"));
          return applyAll(changes).outcome;
        },
        /** Apply changes as far as they go, returning their problems: for a trial copy only. */
        writeItemsUnchecked(changes: ItemChange[]) {
          return applyAll(changes);
        },
        /** Sign a unit, as only an explicit act of signing does. */
        sign(unitId: string, signer: Signer = SPEC_OWNER) {
          const state = self.unitState(unitId);
          if (state == null) throw new UserFacingError("That no longer exists.");
          requireOpen(state.stage, "signing");
          if (!self.isSignable(unitId)) throw new UserFacingError(`${self.unitLabel(unitId)} has nothing to sign.`);
          const node = stageNode(state.stage);
          switch (state.kind) {
            case "item": {
              const item = self.locate(state.itemId)!.item;
              if (state.phase === "proposed-removal") {
                item.removal = { signature: { ...signatureRecord(signer, removalRevision(state.version)), version: state.version } };
                deleteIfSettled(item.id);
                return;
              }
              item.signature = { ...signatureRecord(signer, state.revision), version: state.version, basis: state.currentBasis };
              item.basis = state.currentBasis;
              return;
            }
            case "coverage": {
              node.coverages = {
                ...node.coverages,
                [state.itemId]: {
                  ...signatureRecord(signer, state.covers),
                  item: { id: state.itemId, version: self.versionOf(state.itemId)! },
                  referencing: state.referencing.map((id) => ({ id, version: self.versionOf(id)! })),
                },
              };
              return;
            }
            case "impact": {
              node.impacts = { ...node.impacts, [state.itemId]: { ...signatureRecord(signer, state.covers), before: state.before, after: state.after } };
              const { [state.itemId]: _taken, ...rest } = node.intake;
              node.intake = state.after == null ? rest : { ...rest, [state.itemId]: state.after };
              deleteIfSettled(state.itemId);
              return;
            }
          }
        },
        /** Return an item changed since its last signature, or proposed for removal, to the version that signature covers. */
        restoreSigned(itemId: string) {
          const state = self.itemState(itemId);
          if (state == null || state.signature == null || state.phase === "removed") throw new UserFacingError("There is no signed version to return to.");
          requireOpen(state.stage, "writing");
          const item = self.locate(itemId)!.item;
          const signed = state.signature.version;
          if (state.phase === "active" && revisionOf(signed) === state.revision) throw new UserFacingError(`${state.code} is as signed.`);
          item.removal = null;
          item.content = signed.content;
          item.references = cast([...signed.references]);
          item.dependencies = cast([...signed.dependencies]);
          item.basis = state.signature.basis;
        },
        /** The spec owner asks for a change to a unit: a new thread, or the next message of its open one. Returns the thread's id. */
        requestChange(unitId: string, text: string): string {
          const state = self.unitState(unitId);
          if (state == null) throw new UserFacingError("That no longer exists.");
          requireOpen(state.stage, "change requests");
          if (text.trim().length === 0) throw new UserFacingError("Write what should change.");
          const message = { author: SPEC_OWNER, text: text.trim(), at: new Date().toISOString() };
          const open = self.openThreadOf(unitId);
          if (open != null) {
            addMessage(open.id, message);
            return open.id;
          }
          const thread: Thread = { id: uuid(), unitId, stage: state.stage, removedUnit: null, messages: [message], resolvedAt: null };
          self.threads = [...self.threads, thread];
          return thread.id;
        },
        /** The spec owner replies in an open thread, including one whose unit is gone. */
        replyAsSpecOwner(threadId: string, text: string) {
          const thread = openThread(threadId);
          requireOpen(thread.stage, "thread replies");
          if (text.trim().length === 0) throw new UserFacingError("Write a reply.");
          addMessage(threadId, { author: SPEC_OWNER, text: text.trim(), at: new Date().toISOString() });
        },
        /** The spec owner resolves a thread; only the spec owner does. */
        resolveThread(threadId: string) {
          const thread = openThread(threadId);
          requireOpen(thread.stage, "resolving threads");
          self.threads = self.threads.map((candidate) =>
            candidate.id === threadId ? { ...candidate, resolvedAt: new Date().toISOString() } : candidate,
          );
        },
        /** The answerer replies, alone or together with the changes it made. */
        answerThreads(answers: ThreadAnswer[], author: ThreadAuthor, withChanges = false) {
          const problem = self.answerProblem(answers);
          if (problem != null) throw new UserFacingError(problem);
          for (const { threadId, text } of answers) {
            addMessage(threadId, { author, text: text.trim(), at: new Date().toISOString(), ...(withChanges ? { withChanges: true as const } : {}) });
          }
        },
        /** An answerer takes up the thread's current turn, which ends with the thread's next message. */
        takeUpThread(threadId: string, by: string) {
          const thread = self.threads.find(({ id }) => id === threadId);
          if (thread == null || !waitsForAnswerer(thread)) return;
          const turn = threadTurn(thread);
          const current = new Set(self.threads.filter(waitsForAnswerer).map(threadTurn));
          self.threadsInHand = [
            ...self.threadsInHand.filter((inHand) => current.has(inHand.turn) && !(inHand.turn === turn && inHand.by === by)),
            { turn, by },
          ];
        },
        /** What `by` took up is no longer in hand, such as once its connection ends. */
        releaseThreads(by: string) {
          if (!self.threadsInHand.some((inHand) => inHand.by === by)) return;
          self.threadsInHand = self.threadsInHand.filter((inHand) => inHand.by !== by);
        },
      };
    });
}

export type WorkflowModuleModel = ReturnType<typeof workflowModuleModel>;
export type WorkflowModule = Instance<WorkflowModuleModel>;
