import { comparer } from "mobx";
import { cast, getSnapshot, getType, type Instance, types } from "mobx-state-tree";

import { UserFacingError } from "lib/errors";
import { codesMatch } from "lib/fragmentCodes";
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
  type TurnInHand,
  addedMentionsIn,
  keptMessageText,
  mentionMarkup,
  mentionsIn,
  replaceAddedMentions,
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
  locateItem(id: string): { version: ItemVersion; kind: string; stage: string; phase: ItemPhase } | null;
  itemStanding(id: string): { approved: boolean; outOfDate: boolean } | null;
  codeOf(id: string): string | null;
  /** An item's text as it is now, after its kind's prefix, or nothing for an item it does not hold. */
  textOf(id: string): string;
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

/** The spec owner's request that the coding agent write a stage, and when it was made. */
export interface WritingAsk {
  stage: string;
  at: string;
}

/** One request to write a stage: it changes when the stage is asked for again, so whatever concerned a request ends with it. */
function writingTurn(ask: WritingAsk): string {
  return `write:${ask.stage}:${ask.at}`;
}

/** An item that an item, coverage, impact or marked mention names, of this module or another, as the page names and previews it. */
export interface NamedItem {
  id: string;
  /** The other module, for an item of another module. */
  module: { id: string; name: string } | null;
  code: string;
  /** Its code, or "Module/CODE" for an item of another module. */
  name: string;
  kind: string;
  /** Its text as it is now, after its kind's prefix. */
  text: string;
  stage: string;
  phase: ItemPhase;
  approved: boolean;
}

/** How the page and the agent interface name an item: its code, or "Module/CODE" for an item of another module than the one read. */
function itemName(code: string, moduleName: string | null): string {
  return moduleName == null ? code : `${moduleName}/${code}`;
}

/** The items a version of an item links to: those it lists, and those it counts as linking to without listing them. */
export interface ItemLinks {
  references: string[];
  countedReferences: string[];
  dependencies: string[];
  countedDependencies: string[];
}

/** An item an out-of-date item references or depends on, and why it makes it out of date. */
export interface OutOfDateCause {
  id: string;
  /** The other module's name, for an item of another module. */
  module: string | null;
  reasons: LinkReason[];
  /** For a changed item of this module, the version the out-of-date item rests on and the current one, when the former is still known. */
  change: { from: ItemVersion; to: ItemVersion } | null;
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
  deleted: string[];
  unchanged: string[];
}

/** What reordering a stage did: whether the order changed, and each code that moved. */
export interface ReorderOutcome {
  reordered: boolean;
  recoded: { id: string; before: string; after: string }[];
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
  if (value == null || typeof value === "boolean") return value !== true;
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
      /** The stages the spec owner asked the coding agent to write, until a write reaches them. */
      writingAsked: types.optional(types.frozen<WritingAsk[]>(), []),
    })
    .volatile(() => ({
      /** The project's other modules, which dependencies may name. */
      linkedModules: [] as LinkedModule[],
      /** The turns an answerer is at work on now: of threads, and of requests to write a stage. */
      turnsInHand: [] as TurnInHand[],
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
        return workflow.codeOf(located.item, itemsOf(located.stage));
      });

      /** An item this module's items may link to: its own, or another module's for a dependency. */
      function findLinked(id: string): { version: ItemVersion; kind: string; stage: string; phase: ItemPhase; module: LinkedModule | null } | null {
        const own = locate(id);
        if (own != null) return { version: versionOf(own.item), kind: own.item.kind, stage: own.stage, phase: phaseOf(own.item.removal), module: null };
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

      /**
       * Every thread on a unit, oldest first. Compared by content, so a
       * message in one unit's thread reaches only what reads that unit.
       */
      const threadsOf = keyedView((unitId: string): Thread[] => threadsOfUnit().get(unitId) ?? [], comparer.structural);

      function openThreadOf(unitId: string): Thread | null {
        return threadsOf(unitId).find(({ resolution }) => resolution == null) ?? null;
      }

      /** The items of single kinds that the given stages hold. */
      function singleItemsOf(kinds: readonly string[], stages: readonly string[]): string[] {
        return stages.flatMap((stage) => itemsOf(stage).filter((candidate) => kinds.includes(candidate.kind)).map(({ id }) => id));
      }

      /** The items of a basis stage an item counts as referencing without listing them: those its fields choose, and the items of single kinds it references. */
      function derivedReferencesOf(kind: string, content: ItemContent): string[] {
        const single = singleItemsOf(workflow.kind(kind).referencesSingle ?? [], workflow.basisStages(workflow.stageOfKind(kind)));
        return [...new Set([...workflow.chosenReferences(kind, content), ...single])];
      }

      /** Every item a version of an item references: those it counts as referencing, then those it lists, each once. */
      function referencesOfVersion(kind: string, version: { content: ItemContent; references: readonly string[] }): string[] {
        return [...new Set([...derivedReferencesOf(kind, version.content), ...version.references])];
      }

      function referencesOf(item: Item): string[] {
        return referencesOfVersion(item.kind, item);
      }

      /** The items of its own stage an item counts as depending on without listing them: those its fields choose, and the items of single kinds it depends on. */
      function derivedDependenciesOf(kind: string, content: ItemContent, stage: string, itemId: string | null): string[] {
        const single = singleItemsOf(workflow.kind(kind).dependsOnSingle ?? [], [stage]);
        return [...new Set([...workflow.chosenDependencies(kind, content), ...single])].filter((id) => id !== itemId);
      }

      /** Every item an item depends on: those it counts as depending on, then those it lists, each once. */
      function dependenciesOf(item: Item): string[] {
        const stage = index().get(item.id)?.stage;
        const derived = stage == null ? [] : derivedDependenciesOf(item.kind, item.content, stage, item.id);
        return [...new Set([...derived, ...item.dependencies])];
      }

      /** The items a version of an item links to, those it lists apart from those it counts as linking to; `itemId` is the item's own id, if it has one. */
      function linksOfVersion(kind: string, version: ItemVersion, itemId: string | null): ItemLinks {
        const references = [...version.references];
        const dependencies = [...version.dependencies];
        return {
          references,
          countedReferences: derivedReferencesOf(kind, version.content).filter((id) => !references.includes(id)),
          dependencies,
          countedDependencies: derivedDependenciesOf(kind, version.content, workflow.stageOfKind(kind), itemId).filter((id) => !dependencies.includes(id)),
        };
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

      /**
       * An item's state. Compared by content, like every unit's state: a unit
       * derived again and found as it was stays the very same object, so a
       * change reaches only what reads the units it changes.
       */
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
          let change: OutOfDateCause["change"] = null;
          if (linked == null || linked.phase === "removed") {
            reasons.push("removed");
          } else {
            if (item.basis[linkId] !== revisionOf(linked.version)) {
              reasons.push("changed");
              // The version rested on is still known when it is the one last signed.
              const signed = linked.module == null ? locate(linkId)?.item.signature?.version : undefined;
              if (signed != null && revisionOf(signed) === item.basis[linkId]) change = { from: signed, to: linked.version };
            }
            const standing = linked.module == null ? itemStanding(linkId) : linked.module.lookup.itemStanding(linkId);
            if (standing?.outOfDate === true) reasons.push("out-of-date");
            else if (standing?.approved !== true) reasons.push("not-approved");
          }
          if (reasons.length > 0) outOfDateCauses.push({ id: linkId, module: linked?.module?.name ?? null, reasons, change });
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
      }, comparer.structural);

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

      /** One unit of those a stage's coverages or impacts are derived as, compared by content. */
      function unitOf<State extends UnitStateBase>(kind: "coverage" | "impact", derived: (stage: string) => State[]): (unitId: string) => State | null {
        return keyedView((unitId: string): State | null => {
          const address = parseUnitId(unitId);
          if (address.kind !== kind || !workflow.isStage(address.stage)) return null;
          return derived(address.stage).find((state) => state.unitId === unitId) ?? null;
        }, comparer.structural);
      }

      /** A stage's coverages or impacts, each the object `unitOf` keeps for it. */
      function unitsOf<State extends UnitStateBase>(derived: (stage: string) => State[], one: (unitId: string) => State | null): (stage: string) => State[] {
        return keyedView((stage: string): State[] => derived(stage).map(({ unitId }) => one(unitId)!), comparer.shallow);
      }

      /** A stage's coverages, derived together: each rests on which of the stage's items reference what. */
      const derivedCoverages = keyedView((stage: string): CoverageState[] => {
        const referencingIndex = new Map<string, Item[]>();
        for (const item of activeItems(stage)) {
          for (const reference of referencesOf(item)) {
            referencingIndex.set(reference, [...(referencingIndex.get(reference) ?? []), item]);
          }
        }
        const stored = self.stages.get(stage)?.coverages ?? {};
        return workflow.basisStages(stage).flatMap((basis) =>
          activeItems(basis)
            .filter(({ kind }) => workflow.coveredKinds(stage, basis).includes(kind))
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

      const coverageState = unitOf("coverage", derivedCoverages);
      const coverageStates = unitsOf(derivedCoverages, coverageState);

      /** A stage's impacts, derived together from what it took in and the threads on it. */
      const derivedImpacts = keyedView((stage: string): ImpactState[] => {
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
          if (thread.resolution != null || thread.stage !== stage) continue;
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

      const impactState = unitOf("impact", derivedImpacts);
      const impactStates = unitsOf(derivedImpacts, impactState);

      /** Every unit a stage asks for: its items not yet removed, its coverages and its impacts. */
      const stageUnits = keyedView(
        (stage: string): UnitState[] => [
          ...countedItems(stage).map(({ id }) => itemState(id)!),
          ...coverageStates(stage),
          ...impactStates(stage),
        ],
        comparer.shallow,
      );

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
            return coverageState(unitId);
          case "impact":
            return impactState(unitId);
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

      /** A chosen item by the field its items field shows, or by its code when that is empty. */
      function chosenName(field: FieldDefinition | undefined, id: string): string {
        const located = locate(id);
        if (located == null) return "a removed item";
        const shown = field?.type === "items" ? textValue(located.item.content[field.shows]) : "";
        return shown === "" ? codeById(id)! : shown;
      }

      function shownParts(kind: string, content: ItemContent): ShownParts {
        const definition = workflow.kind(kind);
        const field = (name: string) => definition.fields.find((candidate) => candidate.name === name);
        return {
          content,
          module: reader,
          text: (name) => textValue(content[name]),
          names: (name) => chosenItems(content[name]).map((id) => chosenName(field(name), id)),
        };
      }

      /** The items each of a kind's top-level items fields chooses, each by its code and its shown name. */
      function chosenOf(kind: string, content: ItemContent): { label: string; items: { id: string; code: string | null; name: string }[] }[] {
        return workflow
          .kind(kind)
          .fields.flatMap((field) => (field.type === "items" ? [field] : []))
          .map((field) => ({
            label: field.label,
            items: chosenItems(content[field.name]).map((id) => ({ id, code: codeById(id), name: chosenName(field, id) })),
          }))
          .filter(({ items }) => items.length > 0);
      }

      /** An item's content as its kind displays it, without the kind's prefix. */
      function displayOf(kind: string, content: ItemContent): string {
        return workflow.kind(kind).display(shownParts(kind, content));
      }

      /** An item's content as every view of it shows it: its kind's prefix, if any, then its display. */
      function shownText(kind: string, content: ItemContent): string {
        const prefix = workflow.prefixOf(kind);
        const display = displayOf(kind, content);
        return prefix == null ? display : `${prefix} ${display}`;
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
        referencesOfVersion,
        dependenciesOf,
        derivedDependenciesOf,
        linksOfVersion,
        /** The module as a kind's rules and displays read it. */
        get reader(): ModuleReader {
          return reader;
        },
        shownText,
        displayOf,
        chosenOf,
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
        threadsOf,
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

      /** For every item that makes items of this module out of date, those items, in module order, from one pass over the items. */
      const outOfDateDependents = cachedView((): ReadonlyMap<string, string[]> => {
        const dependents = new Map<string, string[]>();
        for (const item of self.allItems) {
          const causes = new Set((self.itemState(item.id)?.outOfDateCauses ?? []).map((cause) => cause.id));
          for (const cause of causes) dependents.set(cause, [...(dependents.get(cause) ?? []), item.id]);
        }
        return dependents;
      });

      /**
       * The items of this module out of date because of `id`, which may be of
       * another module. Compared by content, so a change elsewhere in the
       * module that leaves this list as it was renders nothing that shows it.
       */
      const outOfDateBecauseOf = keyedView(
        (id: string): string[] => outOfDateDependents().get(id) ?? [],
        comparer.structural,
      );

      /** The stages that build on this item's stage and cover its kind, where no item references it. */
      const stagesNotReferencing = keyedView((id: string): string[] => {
        const located = self.locate(id);
        if (located == null || located.item.removal != null) return [];
        return workflow
          .coveringStages(located.item.kind)
          .filter((stage) => self.coverageStates(stage).find(({ itemId }) => itemId === id)?.referencing.length === 0);
      }, comparer.structural);

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

      /** This module as another module resolves dependencies on it. */
      const lookup: ModuleLookup = {
        locateItem: (id) => {
          const located = self.locate(id);
          return located == null
            ? null
            : { version: self.versionOf(id)!, kind: located.item.kind, stage: located.stage, phase: phaseOf(located.item.removal) };
        },
        itemStanding: (id) => self.itemStanding(id),
        codeOf: (id) => self.codeOf(id),
        textOf: (id) => self.textOf(id),
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

      const mentionableItems = cachedView((): { id: string; name: string }[] => [
        ...self.allItems.filter(({ removal }) => phaseOf(removal) !== "removed").map(({ id }) => ({ id, name: self.codeOf(id)! })),
        ...self.linkedModules.flatMap((linked) => linked.lookup.listItems().map(({ id, code }) => ({ id, name: itemName(code, linked.name) }))),
      ]);

      /** The stages the spec owner asked the coding agent to write that are still open and not complete. */
      const writingAskedOfAnswerer = (): WritingAsk[] => self.writingAsked.filter(({ stage }) => self.stageOpen(stage) && !self.stageComplete(stage));

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
        stagesNotReferencing,
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
        /** The stages that build directly on a complete stage and can be written now, still holding no item. */
        stagesToWriteAfter(stage: string): string[] {
          if (!self.stageComplete(stage)) return [];
          return workflow.stageIds.filter((later) =>
            workflow.basisStages(later).includes(stage) && self.stageOpen(later) && self.itemsOf(later).length === 0,
          );
        },
        get writingAskedOfAnswerer(): WritingAsk[] {
          return writingAskedOfAnswerer();
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
          return self.turnsInHand.some((inHand) => inHand.turn === turn);
        },
        /** An answerer is at work on the request to write the stage now. */
        isBeingWritten(stage: string): boolean {
          const ask = writingAskedOfAnswerer().find((asked) => asked.stage === stage);
          return ask != null && self.turnsInHand.some((inHand) => inHand.turn === writingTurn(ask));
        },
        /** This module as another module resolves dependencies on it. */
        get lookup(): ModuleLookup {
          return lookup;
        },
        /**
         * Every item a thread message of this module can mention, by its name:
         * this module's items in page order, then each other module's in
         * module order and page order; none whose removal is signed.
         */
        get mentionableItems(): { id: string; name: string }[] {
          return mentionableItems();
        },
        /**
         * The item a written name names: a code or id of this module, or,
         * with `otherModules`, "Module name/CODE" of another; or why it
         * names none.
         */
        itemOfName(name: string, otherModules: boolean): { id: string } | { problem: string } {
          const own = itemNamed(name);
          if (own != null) return { id: own };
          const separator = name.lastIndexOf("/");
          if (otherModules && separator > 0) {
            const [moduleName, code] = [name.slice(0, separator), name.slice(separator + 1)];
            const linked = self.linkedModules.find((candidate) => candidate.name === moduleName);
            if (linked == null) return { problem: `there is no other module named ${moduleName}.` };
            const id = linked.lookup.itemNamed(code);
            return id == null ? { problem: `${moduleName} has no item ${code}.` } : { id };
          }
          return { problem: `this module has no item ${name}.` };
        },
        /** An item that an item, coverage or impact of this module, or a marked mention in its threads, names, of this module or another; null once it no longer exists. */
        namedItem(id: string): NamedItem | null {
          const linked = self.findLinked(id);
          if (linked == null) return null;
          const source = linked.module?.lookup ?? lookup;
          const code = source.codeOf(id)!;
          return {
            id,
            module: linked.module == null ? null : { id: linked.module.id, name: linked.module.name },
            code,
            name: itemName(code, linked.module?.name ?? null),
            kind: linked.kind,
            text: source.textOf(id),
            stage: linked.stage,
            phase: linked.phase,
            approved: source.itemStanding(id)?.approved === true,
          };
        },
      };
    })
    .views((self) => ({
      /**
       * What is wrong with each marked mention a message holds, one line
       * each; empty when each gives exactly the current code of the item its
       * id names, and each mention of an added item, `[](change:N)`, names an
       * add among `changes`, those sent with the message.
       */
      mentionProblems(text: string, changes: readonly ItemChange[] = []): string[] {
        const ofItems = mentionsIn(text).flatMap(({ writtenAs, itemId }) => {
          const meant = self.namedItem(itemId);
          if (meant?.name === writtenAs) return [];
          const markup = mentionMarkup(writtenAs, itemId);
          if (writtenAs === "") return [`${markup}: it gives no code.`];
          if (meant == null) return [`${markup}: ${itemId} names no item.`];
          return [`${markup}: the code of ${itemId} is ${meant.name}, not ${writtenAs}.`];
        });
        const ofAdded = addedMentionsIn(text).flatMap(({ change }) => {
          const markup = `[](change:${change})`;
          if (change < 1 || change > changes.length) return [`${markup}: change ${change} is not among the item changes sent with this message.`];
          return changes[change - 1]!.type === "add" ? [] : [`${markup}: change ${change} adds no item.`];
        });
        return [...ofItems, ...ofAdded];
      },
      /** Why the answers cannot be given now, or null. */
      answerProblem(answers: readonly ThreadAnswer[]): string | null {
        for (const { threadId, text } of answers) {
          const thread = self.threads.find(({ id }) => id === threadId);
          if (thread == null) return `There is no thread ${threadId}. Read the open threads with get_workflow_state.`;
          if (thread.resolution != null) return `The spec owner resolved thread ${threadId}.`;
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
      function deleteItem(id: string): void {
        const located = self.locate(id)!;
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
      }

      /** Forget the version of an item that no longer exists, which stages building on it took in. */
      function forgetIntake(id: string): void {
        for (const node of self.stages.values()) {
          if (node.intake[id] == null) continue;
          const { [id]: _dropped, ...rest } = node.intake;
          node.intake = rest;
        }
      }

      /** An item whose removal is signed leaves its stage once no stage still asks for an impact on its removal. */
      function deleteIfSettled(id: string): void {
        const located = self.locate(id);
        if (located == null || phaseOf(located.item.removal) !== "removed") return;
        if (workflow.stageIds.some((stage) => self.stages.get(stage)?.intake[id] != null)) return;
        deleteItem(id);
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
          } else if (expectedKind == null && (definition.referencesSingle ?? []).includes(located.item.kind)) {
            problems.push(`${name} lists ${code} in its references; it counts as referencing it already, so leave it out.`);
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
        const referencedKinds = new Set(
          self.referencesOfVersion(kind, { content, references }).flatMap((id) => {
            const located = self.locate(id);
            return located == null || phaseOf(located.item.removal) === "removed" ? [] : [located.item.kind];
          }),
        );
        const required = definition.mustReference ?? [];
        if (required.length > 0 && !required.some((candidate) => referencedKinds.has(candidate))) {
          const labels = required.map((candidate) => workflow.kind(candidate).label.toLowerCase());
          const named = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}`;
          problems.push(`${name} references no ${named} of this module; reference at least one.`);
        }
        for (const refused of definition.mayNotReference ?? []) {
          if (referencedKinds.has(refused)) {
            problems.push(`${name} references a ${workflow.kind(refused).label.toLowerCase()}; a ${definition.label.toLowerCase()} references none.`);
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
            deleteItem(id);
            outcome.deleted.push(id);
            forgetIntake(id);
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

      /** Refuses a message, naming each one, when a marked mention is wrong; see mentionProblems. */
      function checkMentions(text: string, changes: readonly ItemChange[] = []): void {
        const problems = self.mentionProblems(text, changes);
        if (problems.length > 0) throw new UserFacingError(problems.join("\n"));
      }

      /** A message's text as it is kept, once its marked mentions pass. */
      function keptMessage(text: string): string {
        checkMentions(text);
        return keptMessageText(text);
      }

      /** Posts each answer, its marked mentions already checked, each mention of an added item tied to the item its change added. */
      function postAnswers(answers: readonly ThreadAnswer[], author: ThreadAuthor, changes: readonly ItemChange[] = [], added: readonly string[] = []) {
        const addedBy = (change: number) => added[changes.slice(0, change - 1).filter(({ type }) => type === "add").length]!;
        for (const { threadId, text } of answers) {
          const tied = replaceAddedMentions(text, ({ change }) => mentionMarkup("", addedBy(change)));
          addMessage(threadId, { author, text: keptMessageText(tied), at: new Date().toISOString(), ...(changes.length > 0 ? { withChanges: true as const } : {}) });
        }
      }

      function openThread(threadId: string): Thread {
        const thread = self.threads.find(({ id }) => id === threadId);
        if (thread == null) throw new UserFacingError(`There is no thread ${threadId}.`);
        if (thread.resolution != null) throw new UserFacingError(`Thread ${threadId} is resolved.`);
        return thread;
      }

      /** Record that `by` is at work on a turn, letting go of the turns that have ended. */
      function takeUp(turn: string, by: string) {
        const current = new Set([...self.threads.filter(waitsForAnswerer).map(threadTurn), ...self.writingAskedOfAnswerer.map(writingTurn)]);
        self.turnsInHand = [
          ...self.turnsInHand.filter((inHand) => current.has(inHand.turn) && !(inHand.turn === turn && inHand.by === by)),
          { turn, by },
        ];
      }

      return {
        setLinkedModules(modules: LinkedModule[]) {
          self.linkedModules = modules;
        },
        /**
         * Delete every item whose removal is signed, as if every impact on
         * its removal were settled. For a copy of the module that leaves out
         * signatures, where a removal could not stand unsigned.
         */
        deleteRemovedItems() {
          const removed = [...self.stages.values()].flatMap((node) =>
            node.items.filter((item) => phaseOf(item.removal) === "removed").map(({ id }) => id),
          );
          for (const id of removed) {
            forgetIntake(id);
            deleteItem(id);
          }
        },
        /**
         * Write, change and remove items, all or none. Items are named by
         * id; an item written gets the current versions of what it links to
         * as its basis, and an item written exactly as it was is left as it
         * was. Throws every problem at once. The threads it answers are
         * checked against the module as the write leaves it.
         */
        writeItems(changes: ItemChange[], replies: { answers: readonly ThreadAnswer[]; author: ThreadAuthor } | null = null): ChangeOutcome {
          const answering = replies?.answers ?? [];
          const answerProblem = self.answerProblem(answering);
          if (answerProblem != null) throw new UserFacingError(answerProblem);
          // The answers' marked mentions name items as they are before the write.
          for (const { text } of answering) checkMentions(text, changes);
          // A write never builds on what it changes itself: a stage and a stage building on it change in separate writes.
          const touched = [
            ...new Set(changes.flatMap((change) => {
              const stage = change.type === "add" ? change.stage : self.locate(change.item)?.stage;
              return stage != null && workflow.isStage(stage) ? [stage] : [];
            })),
          ];
          for (const later of touched) {
            const earlier = touched.find((stage) => workflow.buildsOn(later, stage));
            if (earlier == null) continue;
            const [earlierLabel, laterLabel] = [workflow.stage(earlier).label, workflow.stage(later).label];
            throw new UserFacingError(
              `This write changes ${earlierLabel} and ${laterLabel}, which builds on it. Change ${earlierLabel} first; change ${laterLabel} once ${earlierLabel} is complete again.`,
            );
          }
          const trial = getType(self).create(getSnapshot(self)) as unknown as {
            setLinkedModules(modules: LinkedModule[]): void;
            writeItemsUnchecked(changes: ItemChange[]): { outcome: ChangeOutcome; problems: string[] };
            answerProblem(answers: readonly ThreadAnswer[]): string | null;
          };
          trial.setLinkedModules(self.linkedModules);
          const { problems } = trial.writeItemsUnchecked(changes);
          if (problems.length > 0) throw new UserFacingError(problems.join("\n"));
          // Each answer passed above, so one that fails now is in a stage this write closes.
          const closed = answering.find((answer) => trial.answerProblem([answer]) != null);
          if (closed != null) {
            const label = workflow.stage(self.threads.find(({ id }) => id === closed.threadId)!.stage).label;
            throw new UserFacingError(
              `This write closes ${label}, where thread ${closed.threadId} is. Write without answering it, and answer it once ${label} is open again.`,
            );
          }
          const { outcome } = applyAll(changes);
          self.writingAsked = self.writingAsked.filter(({ stage }) => !touched.includes(stage));
          if (replies != null) postAnswers(replies.answers, replies.author, changes, outcome.added);
          return outcome;
        },
        /** Apply changes as far as they go, returning their problems: for a trial copy only. */
        writeItemsUnchecked(changes: ItemChange[]) {
          return applyAll(changes);
        },
        /**
         * Put a stage's items in the given order, all or none. The order names
         * every item of the stage once, by id, and changes no item's content.
         * Only codes, which are positions, move.
         */
        reorderItems(stage: string, itemIds: readonly string[]): ReorderOutcome {
          if (!workflow.isStage(stage)) throw new UserFacingError(`There is no stage ${stage}.`);
          const definition = workflow.stage(stage);
          requireOpen(stage, "reordering");
          const items = self.itemsOf(stage);
          const byId = new Map(items.map((item) => [item.id, item]));
          const seen = new Set<string>();
          const ordered: Item[] = [];
          const problems: string[] = [];
          for (const id of itemIds) {
            const item = byId.get(id);
            if (item == null) {
              problems.push(`${self.codeOf(id) ?? id} is not an item of ${definition.label}.`);
              continue;
            }
            if (seen.has(id)) {
              problems.push(`${self.codeOf(id)} appears more than once in the order.`);
              continue;
            }
            seen.add(id);
            ordered.push(item);
          }
          const missing = items.filter((item) => !seen.has(item.id));
          if (missing.length > 0) {
            problems.push(
              `Name every item of ${definition.label} once; the order leaves out ${missing.map((item) => self.codeOf(item.id)).join(", ")}.`,
            );
          }
          if (problems.length > 0) throw new UserFacingError(problems.join("\n"));
          const before = new Map(items.map((item) => [item.id, self.codeOf(item.id)!]));
          if (items.every((item, index) => item.id === ordered[index]!.id)) return { reordered: false, recoded: [] };
          stageNode(stage).items.replace(ordered);
          return {
            reordered: true,
            recoded: ordered
              .map((item) => ({ id: item.id, before: before.get(item.id)!, after: self.codeOf(item.id)! }))
              .filter(({ before: was, after }) => was !== after),
          };
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
          const message = { author: SPEC_OWNER, text: keptMessage(text), at: new Date().toISOString() };
          const open = self.openThreadOf(unitId);
          if (open != null) {
            addMessage(open.id, message);
            return open.id;
          }
          const thread: Thread = { id: uuid(), unitId, stage: state.stage, removedUnit: null, messages: [message], resolution: null };
          self.threads = [...self.threads, thread];
          return thread.id;
        },
        /** The spec owner asks the coding agent to write a stage that can be written now. */
        askToWrite(stage: string) {
          requireOpen(stage, "writing");
          if (self.stageComplete(stage)) throw new UserFacingError(`${workflow.stage(stage).label} is complete.`);
          self.writingAsked = [...self.writingAsked.filter((ask) => ask.stage !== stage), { stage, at: new Date().toISOString() }];
        },
        /** The spec owner replies in an open thread, including one whose unit is gone. */
        replyAsSpecOwner(threadId: string, text: string) {
          const thread = openThread(threadId);
          requireOpen(thread.stage, "thread replies");
          if (text.trim().length === 0) throw new UserFacingError("Write a reply.");
          addMessage(threadId, { author: SPEC_OWNER, text: keptMessage(text), at: new Date().toISOString() });
        },
        /** The spec owner resolves a thread; only the spec owner does. */
        resolveThread(threadId: string) {
          const thread = openThread(threadId);
          requireOpen(thread.stage, "resolving threads");
          self.threads = self.threads.map((candidate) =>
            candidate.id === threadId ? { ...candidate, resolution: { at: new Date().toISOString() } } : candidate,
          );
        },
        /** The answerer replies, with no changes; a reply with changes is part of writeItems. */
        answerThreads(answers: ThreadAnswer[], author: ThreadAuthor) {
          const problem = self.answerProblem(answers);
          if (problem != null) throw new UserFacingError(problem);
          for (const { text } of answers) checkMentions(text);
          postAnswers(answers, author);
        },
        /** An answerer takes up the thread's current turn, which ends with the thread's next message. */
        takeUpThread(threadId: string, by: string) {
          const thread = self.threads.find(({ id }) => id === threadId);
          if (thread != null && waitsForAnswerer(thread)) takeUp(threadTurn(thread), by);
        },
        /** An answerer takes up the request to write a stage, which ends once the stage is written or asked for again. */
        takeUpWriting(stage: string, by: string) {
          const ask = self.writingAskedOfAnswerer.find((asked) => asked.stage === stage);
          if (ask != null) takeUp(writingTurn(ask), by);
        },
        /** What `by` took up is no longer in hand, such as once its connection ends. */
        releaseTurns(by: string) {
          if (!self.turnsInHand.some((inHand) => inHand.by === by)) return;
          self.turnsInHand = self.turnsInHand.filter((inHand) => inHand.by !== by);
        },
      };
    });
}

export type WorkflowModuleModel = ReturnType<typeof workflowModuleModel>;
export type WorkflowModule = Instance<WorkflowModuleModel>;
