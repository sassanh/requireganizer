import { getSnapshot, getType } from "mobx-state-tree";

import type { ChangeKind } from "history";
import { UserFacingError } from "lib/errors";
import { isRecord } from "lib/json";
import type { Store } from "store";
import {
  addedByChange,
  authorLabel,
  type ChangeOutcome,
  chosenItems,
  coverageUnitId,
  type FieldDefinition,
  impactUnitId,
  type ItemChange,
  type ItemContent,
  type ItemVersion,
  LINK_REASON_LABELS,
  mapItemsFields,
  mentionMarkup,
  mentionsIn,
  NOT_APPROVED_REASON_LABELS,
  parseUnitId,
  REMOVED_ITEM,
  replaceMentions,
  revisionOf,
  signerLabel,
  STAGE_PROGRESS_LABELS,
  type Thread,
  type ThreadAnswer,
  waitsForSpecOwner,
} from "workflow";

import { type Finding, findingsAnnotation, findingsOf, threadAsks } from "../annotations";
import type { AgentDesk } from "../desk";
import { type AgentId, codingAgentId } from "../roster";
import type { WaitingThread } from "../waiting";
import { replyRulesText } from "./replyRules";

type RecordContent = ItemContent;

/** A tool an outside agent can call, as a tool protocol lists it. */
export interface AgentToolDescription {
  name: string;
  description: string;
  /** JSON Schema of the tool's arguments: always an object schema. */
  inputSchema: Record<string, unknown>;
}

/** A unit an agent points the spec owner to: of the open module, or of another by its name. */
export interface PointedUnit {
  module: string | null;
  stage: string;
  unitId: string;
}

/** Another module of the project than the one a call works on, by its name. */
export interface OtherModule {
  id: string;
  name: string;
  /** Its model, to read. */
  store: Store;
  /** Change it without showing it to the spec owner; `run` changes a copy that then takes its place. */
  change<Result>(run: (store: Store) => Result): Result;
}

/**
 * What an agent works on: the module the person has open, named while the
 * project has modules, every other module by its name, and how to add one;
 * and the agents of the project with the threads they have. Nothing here
 * moves the spec owner's page.
 */
export interface OpenModule {
  moduleName?: string;
  /** Another module, by its name; throws for a name no module has. */
  otherModule?: (name: string) => OtherModule;
  /** Add a module, leaving the spec owner's page where it is. */
  addModule?: (name: string) => void;
  /** Point the spec owner to a set of units with one text, offered as one and browsed one by one. */
  pointOut?: (units: readonly PointedUnit[], text: string) => void;
  /**
   * The project's agents and the threads they have, and the open module's
   * id as it names them. Without them no thread is any agent's, and an
   * agent works as before threads were assigned.
   */
  desk?: AgentDesk;
  moduleId?: string;
}

/** The agent calling: the name it gave when it connected. */
export interface AgentCaller {
  name: string;
  /** The connection a coding agent calls through, set by the host; the coding agent is that connection. */
  connection?: string;
  /** An agent Requireganizer runs, calling as itself. */
  agentId?: AgentId;
}

type Arguments = Record<string, unknown>;

/** The agent calling as the threads it may have know it: null while the project has no desk. */
interface CallingAgent {
  id: AgentId;
  /** The name its messages are signed with. */
  name: string;
}

interface AgentTool {
  description: AgentToolDescription;
  /** Takes `module`, to work on another module than the open one; its schema gets the property. */
  inModule?: boolean;
  /**
   * The argument naming, by its id, the thread assigned to the calling agent
   * that this call is about. The call then works on that thread's module,
   * whatever the module the spec owner has open or the call names.
   */
  assigned?: { argument: string };
  /** The kind of change a call makes, as its step names it; null for a tool that only reads. */
  makes: ChangeKind | null;
  run(store: Store, args: Arguments, open: OpenModule, caller: AgentCaller, agent: CallingAgent | null, assigned: WaitingThread | null): string;
}

function stringArgument(args: Arguments, name: string): string {
  const value = args[name];
  if (typeof value !== "string") throw new UserFacingError(`${name} must be a string.`);
  return value;
}

function optionalStrings(args: Record<string, unknown>, name: string, label: string): string[] | undefined {
  const value = args[name];
  if (value == null) return undefined;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new UserFacingError(`${label}: ${name} must be a list of codes.`);
  }
  return value as string[];
}

function stageNamed(store: Store, name: unknown): string {
  if (!store.workflow.isStage(name)) {
    throw new UserFacingError(`There is no stage ${JSON.stringify(name)}. The stages are ${store.workflow.stageIds.join(", ")}.`);
  }
  return name;
}

/** Refuse a write whose codes come from a read before the codes moved. */
function requireCodesVersion(store: Store, args: Arguments): void {
  const given = stringArgument(args, "codesVersion");
  if (given !== store.codesVersion) {
    throw new UserFacingError(
      `The codes moved since codesVersion ${given}; it is ${store.codesVersion} now. Read get_items again and name the items by the new codes.`,
    );
  }
}

/** How a linked item is named to the agent: by code in this module, or as "Module name/CODE" in another. */
function linkName(store: Store, id: string): string {
  return store.itemNameOf(id) ?? `a removed item (${id})`;
}

/** A version as an agent reads it: its text and marks as the page shows them, its fields with chosen items by code, and its links by code. */
function versionView(store: Store, kind: string | null, version: ItemVersion): Record<string, unknown> {
  const fields = kind == null
    ? version.content
    : mapItemsFields(store.workflow.kind(kind).fields, version.content, (value, field) => {
        const codes = chosenItems(value).map((id) => linkName(store, id));
        return field.single ? (codes[0] ?? null) : codes;
      });
  const marks = kind == null ? [] : store.marksOf(kind, version.content);
  return {
    ...(kind == null ? {} : { text: store.shownText(kind, version.content) }),
    ...(marks.length === 0 ? {} : { marks }),
    fields,
    references: version.references.map((id) => linkName(store, id)),
    dependencies: version.dependencies.map((id) => linkName(store, id)),
  };
}

/** One item as an agent works with it: its code, state, fields and links by code, and what changed since it was signed. */
function itemView(store: Store, id: string): Record<string, unknown> {
  const state = store.itemState(id)!;
  const now = versionView(store, state.itemKind, state.version);
  const signed = state.signature == null ? null : versionView(store, state.itemKind, state.signature.version);
  const sinceSigned: Record<string, unknown> = {};
  if (signed != null && !state.signatureCounts) {
    for (const key of ["text", "fields", "references", "dependencies"] as const) {
      if (JSON.stringify(signed[key]) !== JSON.stringify(now[key])) sinceSigned[key] = signed[key];
    }
  }
  const dependents = store.dependentsOutOfDate(id);
  return {
    code: state.code,
    id,
    kind: state.itemKind,
    ...(state.phase === "active" ? {} : { removal: state.phase === "removed" ? "removed, waiting for impacts" : "proposed" }),
    approved: state.approved,
    ...(state.approved ? {} : { notApprovedBecause: state.reasons.map((reason) => NOT_APPROVED_REASON_LABELS[reason]) }),
    ...now,
    ...(state.outOfDateCauses.length === 0
      ? {}
      : {
          outOfDateBecause: state.outOfDateCauses.map((cause) => ({
            item: linkName(store, cause.id),
            reasons: cause.reasons.map((reason) => LINK_REASON_LABELS[reason]),
          })),
        }),
    ...(dependents.length === 0
      ? {}
      : { makesOutOfDate: dependents.map(({ module, code }) => (module == null ? code : `${module}/${code}`)) }),
    ...(state.signature == null
      ? { signature: "never signed" }
      : { signedBy: signerLabel(state.signature.signer), signatureCounts: state.signatureCounts }),
    ...(Object.keys(sinceSigned).length === 0 ? {} : { sinceSigned }),
    ...(state.openThread == null ? {} : { openThreadId: state.openThread.id }),
  };
}

/**
 * The unit a thread is on. A removed unit keeps the code it had then, which
 * another item may hold now, so it is named as removed, with what it said,
 * by which a reply names it.
 */
function threadUnit(store: Store, thread: Thread): Record<string, unknown> {
  if (thread.unitId == null) return { on: "the stage itself" };
  return thread.removedUnit == null
    ? { unit: store.unitLabel(thread.unitId) }
    : { unit: `${thread.removedUnit.name} (removed)`, unitRemoved: true, removedUnitText: thread.removedUnit.text };
}

/**
 * A message's text as an agent reads it: each marked mention by its item's
 * code now and its id, as a reply writes it again, or as a removed item once
 * its item no longer exists.
 */
function messageText(store: Store, text: string): string {
  return replaceMentions(text, ({ itemId }) => mentionMarkup(store.itemNameOf(itemId) ?? REMOVED_ITEM, itemId));
}

/** Whom a thread waits for, as the calling agent reads it. */
type ThreadStatus = (thread: Thread) => string;

/** A finding as an agent reads it: its item by its code now, or as removed, and whether the item changed since the finding was given. */
function findingView(store: Store, { itemId, revision, rule, how }: Finding): Record<string, unknown> {
  const version = store.findLinked(itemId)?.version;
  return { item: store.itemNameOf(itemId) ?? REMOVED_ITEM, rule, how, ...(version != null && revisionOf(version) !== revision ? { itemChangedSince: true } : {}) };
}

function threadView(store: Store, thread: Thread, status: ThreadStatus): Record<string, unknown> {
  return {
    threadId: thread.id,
    ...threadUnit(store, thread),
    stage: thread.stage,
    ...(thread.unitId == null && threadAsks(thread) !== "message" ? { asks: `${threadAsks(thread)} the stage` } : {}),
    status: status(thread),
    messages: thread.messages.map((message) => {
      const findings = findingsOf(message);
      return {
        from: message.author.kind === "person" ? "spec owner" : authorLabel(message.author),
        at: message.at,
        text: messageText(store, message.text),
        ...(message.withChanges ? { withChanges: message.withChanges } : {}),
        ...(findings.length === 0 ? {} : { findings: findings.map((finding) => findingView(store, finding)) }),
      };
    }),
  };
}

/** A thread with the item it is on, as get_items gives it, or that its unit is gone. */
function threadWithUnit(store: Store, thread: Thread, status: ThreadStatus): Record<string, unknown> {
  const address = thread.unitId == null ? null : parseUnitId(thread.unitId);
  const isItem = address?.kind === "item" && store.itemState(address.itemId) != null;
  return {
    ...threadView(store, thread, status),
    ...(isItem ? { item: itemView(store, address.itemId) } : {}),
  };
}

function coverageAndImpactViews(store: Store, stage: string): Record<string, unknown> {
  const coverages = store.coverageStates(stage).map((coverage) => ({
    unit: store.unitLabel(coverage.unitId),
    approved: coverage.approved,
    ...(coverage.approved ? {} : { notApprovedBecause: coverage.reasons.map((reason) => NOT_APPROVED_REASON_LABELS[reason]) }),
    referencedBy: coverage.referencing.map((id) => store.codeOf(id)),
    ...(coverage.openThread == null ? {} : { openThreadId: coverage.openThread.id }),
  }));
  const impacts = store.impactStates(stage).map((impact) => {
    const kind = store.locate(impact.itemId)?.item.kind ?? null;
    return {
      unit: store.unitLabel(impact.unitId),
      approved: impact.approved,
      ...(impact.approved ? {} : { notApprovedBecause: impact.reasons.map((reason) => NOT_APPROVED_REASON_LABELS[reason]) }),
      before: versionView(store, kind, impact.before),
      after: impact.after == null ? "removed" : versionView(store, kind, impact.after),
      ...(impact.openThread == null ? {} : { openThreadId: impact.openThread.id }),
    };
  });
  return { coverages, impacts };
}

/** The item a code names in this module or, written "Module name/CODE", in another. */
function resolveLink(store: Store, name: string, allowOtherModules: boolean, label: string): string {
  const named = store.itemOfName(name, allowOtherModules);
  if ("problem" in named) throw new UserFacingError(`${label}: ${named.problem}`);
  return named.id;
}

/** The fields an agent wrote, with the codes its items fields choose, at any depth, resolved to ids; the model checks the rest. */
function parseFields(store: Store, kind: string, value: unknown, label: string): ItemContent | undefined {
  if (value == null) return undefined;
  if (!isRecord(value)) throw new UserFacingError(`${label}: fields must be an object mapping field names to values.`);
  return mapItemsFields(store.workflow.kind(kind).fields, value as RecordContent, (written, field) => {
    if (written == null) return [];
    if (field.single && typeof written === "string") return [resolveLink(store, written, false, label)];
    if (!Array.isArray(written) || !written.every((code) => typeof code === "string")) {
      throw new UserFacingError(`${label}: ${field.name} must be ${field.single ? "one code" : "a list of codes"} of a ${store.workflow.kind(field.of).label.toLowerCase()}.`);
    }
    return (written as string[]).map((code) => resolveLink(store, code, false, label));
  });
}

/** The changes an agent asked for, with every code resolved against the module as it is now. */
function parseChanges(store: Store, value: unknown): ItemChange[] {
  if (!Array.isArray(value)) throw new UserFacingError("changes must be a list.");
  const problems: string[] = [];
  const changes = value.flatMap((entry, index): ItemChange[] => {
    const label = `Change ${index + 1}`;
    try {
      if (!isRecord(entry)) throw new UserFacingError(`${label} must be an object.`);
      const references = optionalStrings(entry, "references", label)?.map((name) => resolveLink(store, name, false, label));
      const dependencies = optionalStrings(entry, "dependencies", label)?.map((name) => resolveLink(store, name, true, label));
      switch (entry.action) {
        case "add": {
          const stage = stageNamed(store, entry.stage);
          const kinds = store.workflow.stage(stage).kinds;
          const kind = entry.kind ?? (kinds.length === 1 ? kinds[0]!.kind : undefined);
          if (typeof kind !== "string") {
            throw new UserFacingError(`${label}: name the kind, one of ${kinds.map(({ kind: name }) => name).join(", ")}.`);
          }
          if (!store.workflow.isKind(kind)) throw new UserFacingError(`${label}: there is no kind ${kind}.`);
          return [{ type: "add", stage, kind, content: parseFields(store, kind, entry.fields, label) ?? {}, references: references ?? [], dependencies: dependencies ?? [] }];
        }
        case "change": {
          const item = resolveLink(store, stringArgument(entry, "item"), false, label);
          const content = parseFields(store, store.locate(item)!.item.kind, entry.fields, label);
          return [{ type: "change", item, content, references, dependencies }];
        }
        case "remove":
          return [{ type: "remove", item: resolveLink(store, stringArgument(entry, "item"), false, label) }];
        default:
          throw new UserFacingError(`${label}: action must be add, change or remove.`);
      }
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      return [];
    }
  });
  if (problems.length > 0) throw new UserFacingError(problems.join("\n"));
  return changes;
}

/**
 * A reply as an agent sends it. The store checks its marked mentions, as it
 * checks every message; what is the agent interface's alone is checked here:
 * a reply with a marked mention of an existing item names the codesVersion
 * its codes come from, and, when those codes moved since, a refusal says so.
 */
function parseReply(store: Store, threadId: string, text: string, codesVersion: unknown, changes: readonly ItemChange[]): ThreadAnswer {
  if (mentionsIn(text).length > 0 && typeof codesVersion !== "string") {
    throw new UserFacingError("A reply with a marked mention needs the codesVersion of the get_items or get_workflow_state read its codes come from.");
  }
  const problems = store.mentionProblems(text, changes);
  if (problems.length === 0) return { threadId, text };
  if (mentionsIn(text).length > 0 && codesVersion !== store.codesVersion) {
    problems.push(`The codes moved since codesVersion ${codesVersion}; it is ${store.codesVersion} now. Read get_items again and write each mention with the item's code and id from that read.`);
  }
  throw new UserFacingError(problems.join("\n"));
}

function parseAnswers(store: Store, value: unknown, codesVersion: unknown, changes: readonly ItemChange[]): ThreadAnswer[] {
  if (value == null) return [];
  if (
    !Array.isArray(value) ||
    !value.every((entry) => isRecord(entry) && typeof entry.threadId === "string" && typeof entry.reply === "string")
  ) {
    throw new UserFacingError("answers must be a list of { threadId, reply, findings }.");
  }
  return value.map(({ threadId, reply, findings }: { threadId: string; reply: string; findings?: unknown }) => {
    const answer = parseReply(store, threadId, reply, codesVersion, changes);
    const annotations = findingsAnnotation(parseFindings(store, findings, `The reply to thread ${threadId}`));
    return annotations == null ? answer : { ...answer, annotations };
  });
}

/**
 * The findings a reply gives, each naming an item of any module, a
 * published rule of that item's kind and how the item breaks it, with the
 * item's revision now. Throws every problem at once, so the call changes
 * nothing.
 */
function parseFindings(store: Store, value: unknown, label: string): Finding[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new UserFacingError(`${label}: findings must be a list of { item, rule, how }.`);
  const problems: string[] = [];
  const findings = value.flatMap((entry, index): Finding[] => {
    const named = `${label}, finding ${index + 1}`;
    if (!isRecord(entry) || typeof entry.item !== "string" || entry.item.trim().length === 0) {
      problems.push(`${named} names no item. Give its code, or "Module name/CODE" for another module's.`);
      return [];
    }
    const found = store.itemOfName(entry.item.trim(), true);
    const linked = "id" in found ? store.findLinked(found.id) : null;
    if (!("id" in found) || linked == null) {
      problems.push(`${named}: ${"problem" in found ? found.problem : `${entry.item} names no item.`}`);
      return [];
    }
    const published = store.workflow.publishedRules(linked.kind);
    const rule = typeof entry.rule === "string" ? entry.rule.trim() : "";
    if (![...published.rules, ...published.shared].includes(rule)) {
      problems.push(`${named}: ${rule.length === 0 ? "it names no rule" : `“${rule}” is not a published rule of ${store.workflow.kind(linked.kind).plural.toLowerCase()}`}. Give the rule exactly as get_stage_rules publishes it, among the kind's rules or the shared rules.`);
      return [];
    }
    const how = typeof entry.how === "string" ? entry.how.trim() : "";
    if (how.length === 0) {
      problems.push(`${named}: say how ${entry.item} breaks the rule.`);
      return [];
    }
    return [{ itemId: found.id, revision: revisionOf(linked.version), rule, how }];
  });
  if (problems.length > 0) throw new UserFacingError(problems.join("\n"));
  return findings;
}

const FINDINGS_PROPERTY = {
  type: "array",
  description:
    "Only from the agent the thread is assigned to: what the reply finds wrong with items, each naming an item of any module, a published rule of its kind that it breaks, and how. The spec owner sees each finding with the reply, and on its item while the item is unchanged. A finding that names no item, no published rule of its item's kind, or not how the item breaks it, refuses the whole call and changes nothing.",
  items: {
    type: "object",
    properties: {
      item: { type: "string", description: "The item's code, or \"Module name/CODE\" for an item of another module, from get_items." },
      rule: { type: "string", minLength: 1, description: "The rule it breaks, exactly as get_stage_rules publishes it among its kind's rules or the shared rules." },
      how: { type: "string", minLength: 1, description: "How the item breaks the rule." },
    },
    required: ["item", "rule", "how"],
    additionalProperties: false,
  },
};


/** The longest text a pointer may give with what it names. */
const POINTER_TEXT_LIMIT = 80;

/** What a pointer names, before the write it comes with runs: a unit by its code, or an item the write adds by its change. */
type PointerTarget =
  | { kind: "unit"; unit: PointedUnit; name: string }
  | { kind: "change"; change: number };

interface Pointer {
  targets: PointerTarget[];
  text: string;
}

const POINTER_PROPERTY = {
  type: "object",
  description: `A set of items, coverages and impacts, of this module or others, to point the spec owner to, with one text saying why the set needs them. The spec owner is offered a way to go to each in turn; nothing moves their focus. Name each by item, the item's code or "Module name/CODE" from get_items, with unit and stage for its coverage or impact; or, for an item this write adds, by change instead of item. A member that names nothing, or a change that adds no item, or a text missing or longer than ${POINTER_TEXT_LIMIT} characters, refuses the whole call and changes nothing.`,
  properties: {
    units: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          item: { type: "string", description: "The item's code, or \"Module name/CODE\" for an item of another module." },
          unit: { type: "string", enum: ["item", "coverage", "impact"], description: "The item itself, the default, or its coverage or impact in stage." },
          stage: { type: "string", description: "For a coverage or an impact: the stage that holds it." },
          change: { type: "integer", minimum: 1, description: "For an item this write adds, in place of item: the place of its add change among the changes, counting from 1." },
        },
        additionalProperties: false,
      },
    },
    text: { type: "string", description: `Why the set needs the spec owner, at most ${POINTER_TEXT_LIMIT} characters, such as "Answers your question".` },
  },
  required: ["units", "text"],
  additionalProperties: false,
};

/** One member of a pointer's set, checked against the module as it is before the write and the changes it sends. */
function parsePointerTarget(store: Store, open: OpenModule, value: unknown, changes: readonly ItemChange[], label: string): PointerTarget {
  if (!isRecord(value)) throw new UserFacingError(`${label} must be an object naming an item, coverage or impact.`);
  const unit = value.unit ?? "item";
  if (unit !== "item" && unit !== "coverage" && unit !== "impact") throw new UserFacingError(`${label}: unit must be item, coverage or impact.`);
  if (value.change != null) {
    if (value.item != null) throw new UserFacingError(`${label} names an item by item or by change, not both.`);
    if (unit !== "item") throw new UserFacingError(`${label}: change names the item it adds; name a coverage or an impact by item and stage.`);
    const change = value.change;
    if (typeof change !== "number" || !Number.isInteger(change) || changes[change - 1]?.type !== "add") {
      throw new UserFacingError(`${label}: change ${String(change)} adds no item. Give the place of an add change among the changes, counting from 1.`);
    }
    return { kind: "change", change };
  }
  if (typeof value.item !== "string") throw new UserFacingError(`${label} names nothing. Give item, the code of what to point to, or change.`);
  const name = value.item;
  const nothing = () =>
    new UserFacingError(`${label}: ${name}${unit === "item" ? "" : ` ${unit}`} names no item, coverage or impact. Name one as get_items gives it, or "Module name/CODE" for another module's.`);
  const named = store.itemOfName(name, true);
  if ("problem" in named) throw nothing();
  const own = store.locate(named.id);
  const linked = own == null ? store.linkedModules.find((other) => other.lookup.locateItem(named.id) != null) : undefined;
  const moduleName = own == null ? (linked?.name ?? null) : null;
  const itemStage = own?.stage ?? linked?.lookup.locateItem(named.id)?.stage;
  if (itemStage == null) throw nothing();
  if (unit === "item") return { kind: "unit", unit: { module: moduleName, stage: itemStage, unitId: named.id }, name };
  if (!store.workflow.isStage(value.stage)) throw nothing();
  const unitId = unit === "coverage" ? coverageUnitId(value.stage, named.id) : impactUnitId(value.stage, named.id);
  const holder = moduleName == null ? store : open.otherModule?.(moduleName).store;
  if (holder?.unitState(unitId) == null) throw nothing();
  return { kind: "unit", unit: { module: moduleName, stage: value.stage, unitId }, name };
}

/**
 * The pointer an agent sent, checked against the module as it is before
 * the write and the changes it sends; null when it sent none. Throws what
 * is wrong with it, so the call changes nothing.
 */
function parsePointer(store: Store, open: OpenModule, value: unknown, changes: readonly ItemChange[]): Pointer | null {
  if (value == null) return null;
  if (!isRecord(value)) throw new UserFacingError("pointTo must be an object with the units to point to and a text.");
  const text = typeof value.text === "string" ? value.text.trim() : "";
  if (text.length === 0) throw new UserFacingError(`pointTo gives no text. Say in at most ${POINTER_TEXT_LIMIT} characters why the set needs the spec owner.`);
  if (text.length > POINTER_TEXT_LIMIT) {
    throw new UserFacingError(`pointTo's text is ${text.length} characters long. Shorten it to at most ${POINTER_TEXT_LIMIT}.`);
  }
  if (!Array.isArray(value.units) || value.units.length === 0) throw new UserFacingError("pointTo names nothing. Give units, the items, coverages and impacts to point to.");
  const problems: string[] = [];
  const targets = value.units.flatMap((entry, index): PointerTarget[] => {
    try {
      return [parsePointerTarget(store, open, entry, changes, `pointTo unit ${index + 1}`)];
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      return [];
    }
  });
  if (problems.length > 0) throw new UserFacingError(problems.join("\n"));
  return { targets, text };
}

/** Point the spec owner to what a pointer names, once its write ran; the line the reply says it with. */
function pointOut(store: Store, open: OpenModule, pointer: Pointer, changes: readonly ItemChange[], added: readonly string[]): string {
  const resolved = pointer.targets.map((target): { unit: PointedUnit; name: string } => {
    if (target.kind === "unit") return target;
    const itemId = addedByChange(changes, added, target.change)!;
    return { unit: { module: null, stage: store.locate(itemId)!.stage, unitId: itemId }, name: store.codeOf(itemId)! };
  });
  // A unit of the module the call works on is named by that module, which need not be the one shown.
  open.pointOut?.(resolved.map(({ unit }) => ({ ...unit, module: unit.module ?? open.moduleName ?? null })), pointer.text);
  return `The spec owner is offered a way to go to ${resolved.map(({ name }) => name).join(", ")}.`;
}

/** Every item's code, by id, as a write names them before it runs. */
function codesNow(store: Store): Map<string, string> {
  const codes = new Map<string, string>();
  for (const stage of store.workflow.stageIds) {
    for (const { id } of store.itemsOf(stage)) {
      const code = store.codeOf(id);
      if (code != null) codes.set(id, code);
    }
  }
  return codes;
}

/**
 * What a write did, each item named by the code the write named it by, with
 * its code after the write where that moved; an added item by its new code.
 */
function outcomeLines(store: Store, outcome: ChangeOutcome, codesBefore: ReadonlyMap<string, string>): string[] {
  const nameOf = (id: string) => {
    const before = codesBefore.get(id);
    const after = store.codeOf(id);
    if (before == null) return after ?? id;
    return after == null || after === before ? before : `${before} (now ${after})`;
  };
  const named = (ids: string[]) => ids.map(nameOf).join(", ");
  return [
    ...(outcome.added.length === 0 ? [] : [`Added: ${named(outcome.added)}.`]),
    ...(outcome.changed.length === 0 ? [] : [`Changed: ${named(outcome.changed)}.`]),
    ...(outcome.removalWithdrawn.length === 0 ? [] : [`Removal withdrawn: ${named(outcome.removalWithdrawn)}.`]),
    ...(outcome.proposedForRemoval.length === 0 ? [] : [`Proposed for removal, waiting for the spec owner's signature: ${named(outcome.proposedForRemoval)}.`]),
    ...(outcome.deleted.length === 0 ? [] : [`Removed at once, never signed: ${named(outcome.deleted)}.`]),
    ...(outcome.unchanged.length === 0 ? [] : [`Left as they were, since nothing in them changed: ${named(outcome.unchanged)}.`]),
  ];
}

const STAGE_PROPERTY = { type: "string", description: "A stage id, as get_workflow_state lists them." };

/** The desk and the open module's id as it names waiting threads; null while the project has none. */
function deskOf(open: OpenModule): { desk: AgentDesk; moduleId: string } | null {
  return open.desk == null || open.moduleId == null ? null : { desk: open.desk, moduleId: open.moduleId };
}

/** The wait of a thread of the module a call works on and the agent that has it; null when the thread does not wait for an agent. */
function waitOf(open: OpenModule, thread: Thread): { waiting: WaitingThread; holder: AgentId | null } | null {
  const found = deskOf(open);
  const waiting = found == null ? null : found.desk.waitingIn(found.moduleId, thread.id);
  return waiting == null ? null : { waiting, holder: found!.desk.holderOf(waiting.key)?.agentId ?? null };
}

/** The wait of a thread assigned to the calling agent; null when the thread is not assigned to it. */
function heldByCaller(open: OpenModule, agent: CallingAgent | null, thread: Thread): WaitingThread | null {
  const found = waitOf(open, thread);
  return found != null && agent != null && found.holder === agent.id ? found.waiting : null;
}

/** Whom each thread waits for, as the calling agent reads it. */
function statusOf(open: OpenModule, agent: CallingAgent | null): ThreadStatus {
  return (thread) => {
    if (thread.resolution != null) return "resolved";
    const found = waitOf(open, thread);
    if (found == null) return waitsForSpecOwner(thread) ? "waiting for the spec owner" : "open; no agent is to answer it";
    if (found.holder == null) return "waiting for the spec owner to assign it to an agent";
    return agent != null && found.holder === agent.id ? "waiting for you" : "assigned to another agent";
  };
}

/** The threads assigned to the calling agent in the module a call works on, each with its wait. */
function assignedToCaller(store: Store, open: OpenModule, agent: CallingAgent | null): { thread: Thread; waiting: WaitingThread }[] {
  const found = deskOf(open);
  if (found == null || agent == null) return [];
  return found.desk
    .heldThreads()
    .filter((waiting) => waiting.moduleId === found.moduleId && waiting.agentId === agent.id)
    .flatMap((waiting) => {
      const thread = store.threads.find(({ id }) => id === waiting.thread.id);
      return thread == null ? [] : [{ thread, waiting }];
    });
}

/**
 * The thread a tool call names by its id, assigned to the calling agent;
 * null when the tool names none or the call names none.
 */
function assignedNamedBy(tool: AgentTool, args: Arguments, open: OpenModule, agent: CallingAgent | null): WaitingThread | null {
  const named = tool.assigned;
  if (named == null) return null;
  const value = args[named.argument];
  if (value == null) return null;
  if (typeof value !== "string") throw new UserFacingError(`${named.argument} must be the id given with a thread assigned to you.`);
  const found = deskOf(open);
  if (found == null || agent == null) throw new UserFacingError("No thread is assigned to any agent in this project.");
  return found.desk.requireHeld(agent.id, value);
}

/** The stages a write would close: open before it and closed after, tried on a copy of the module. */
function stagesClosedBy(store: Store, changes: readonly ItemChange[]): string[] {
  const trial = getType(store).create(getSnapshot(store)) as Store;
  trial.setLinkedModules(store.linkedModules);
  trial.writeItemsUnchecked([...changes]);
  return store.workflow.stageIds.filter((stage) => store.stageOpen(stage) && !trial.stageOpen(stage));
}

/** The stage each change changes. */
function stagesChangedBy(store: Store, changes: readonly ItemChange[]): string[] {
  return [...new Set(changes.flatMap((change) => {
    const stage = change.type === "add" ? change.stage : store.locate(change.item)?.stage;
    return stage == null ? [] : [stage];
  }))];
}

const workflowStateTool: AgentTool = {
  makes: null,
  description: {
    name: "get_workflow_state",
    description:
      "Get a module's workflow state: the one the spec owner has open, or the one module names. It says whether every stage is complete, and for each stage whether it is open (every stage it builds on is complete, so it can be written, signed and discussed) or closed, its progress (empty, in progress, complete), how many of its items, coverages and impacts are approved out of how many, what in it is signable, and its open threads. Its open threads include those on the stage itself. threadsAssignedToYou lists the threads of the module you read that the spec owner assigned to you, each with the id you pass back, its thread and what it asks: an answer to the spec owner's message, or the writing or a review of the thread's stage. Items are named by the codes of codesVersion. Pass module to read another module's state.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  inModule: true,
  run: (store, _args, open, _caller, agent) => {
    const mine = assignedToCaller(store, open, agent);
    const stages = store.workflow.stageIds.map((stage) => {
      const summary = store.stageSummary(stage);
      const definition = store.workflow.stage(stage);
      return {
        stage,
        label: definition.label,
        buildsOn: definition.buildsOn,
        state: summary.open ? "open" : "closed",
        progress: STAGE_PROGRESS_LABELS[summary.progress],
        approved: `${summary.approved} of ${summary.total}`,
        signable: summary.signable,
        openThreads: store.threadsOfStage(stage).filter(({ resolution }) => resolution == null).map((thread) => threadView(store, thread, statusOf(open, agent))),
      };
    });
    return JSON.stringify({
      ...(open.moduleName == null ? {} : { module: open.moduleName }),
      otherModules: store.linkedModules.map(({ name }) => name),
      codesVersion: store.codesVersion,
      complete: store.isComplete,
      stages,
      threadsAssignedToYou: mine.map(({ thread, waiting }) => ({
        id: waiting.key,
        asks: waiting.kind === "message" ? "an answer to the spec owner's message" : `${waiting.kind} the stage`,
        threadId: thread.id,
        ...threadUnit(store, thread),
        stage: thread.stage,
      })),
    });
  },
};

/** A field as get_stage_rules describes it, a record's fields within it. */
function fieldView(field: FieldDefinition): Record<string, unknown> {
  return {
    name: field.name,
    type: field.type,
    required: field.required,
    description: field.description,
    ...(field.type === "choice" ? { options: field.options } : {}),
    ...(field.type === "text" && field.prefix != null ? { shownAfter: field.prefix } : {}),
    ...(field.type === "items" ? { chooses: field.of, ...(field.single ? { single: true } : {}) } : {}),
    ...(field.type === "records" ? { entry: field.entry } : {}),
    ...(field.type === "record" || field.type === "records" ? { fields: field.fields.map(fieldView) } : {}),
  };
}

const stageRulesTool: AgentTool = {
  makes: null,
  description: {
    name: "get_stage_rules",
    description:
      "Read the published rules of each kind of item one stage holds, the same the spec owner reads and signs against, and the shared rules every kind follows. For each kind: the question its items answer, which decides what belongs in an item of it; its own rules; its code and fields; the kinds of the stages it builds on whose coverage its items give; what it must reference: for each entry, at least one item of any of its kinds, and with when only an item whose field holds that option, such as a requirement whose type is constraint; the kinds it never references; the single items it counts as referencing or depending on without listing them; an example of its fields where the shape is not plain; and examples: one item of the kind, then items of other kinds, or wrong items of the same kind, that could pass for one, each with why it is not. Each field has a type: text; choice, one of its options; flag, true or false; texts, a list of texts; items, a list of codes of the kind it chooses, or one code, never a list, when single, which count as the item's references when that kind is in a stage this stage builds on, or as its dependencies when it is in this stage, and are never listed again in references or dependencies; record, an object of its own fields, or null for none; records, a list of such objects, one per entry. A field with shownAfter holds only what follows those words. A refused write names the field by its place, such as \"AT-01, Then step 2: Comparison\". Read them before writing a stage.",
    inputSchema: { type: "object", properties: { stage: STAGE_PROPERTY }, required: ["stage"], additionalProperties: false },
  },
  run: (store, args, open, caller) => {
    const stage = store.workflow.stage(stageNamed(store, args.stage));
    return JSON.stringify({
      stage: stage.id,
      label: stage.label,
      buildsOn: stage.buildsOn,
      kinds: stage.kinds.map((kind) => {
        const published = store.workflow.publishedRules(kind.kind);
        return {
          kind: kind.kind,
          label: kind.label,
          question: published.question,
          rules: published.rules,
          code: kind.code,
          ...(kind.single ? { single: true } : {}),
          fields: kind.fields.map(fieldView),
          ...(kind.covers == null ? {} : { covers: kind.covers }),
          ...(kind.mustReference == null
            ? {}
            : { mustReference: kind.mustReference.map((rule) => ({ atLeastOneOf: rule.kinds, ...(rule.when == null ? {} : { when: rule.when }) })) }),
          ...(kind.mayNotReference == null ? {} : { neverReferences: kind.mayNotReference }),
          ...(kind.referencesSingle == null ? {} : { countsAsReferencing: kind.referencesSingle }),
          ...(kind.dependsOnSingle == null ? {} : { countsAsDependingOn: kind.dependsOnSingle }),
          ...(kind.example == null ? {} : { exampleFields: kind.example }),
          examples: {
            item: published.examples.good,
            couldPassForOne: published.examples.traps.map(({ kind: trapKind, text, why }) => ({ kind: trapKind, text, why })),
          },
        };
      }),
      sharedRules: store.workflow.sharedRules,
    });
  },
};

const itemsTool: AgentTool = {
  makes: null,
  description: {
    name: "get_items",
    description:
      "List one stage's items in the order the page shows them, with the codesVersion a write naming them by code sends back: each with its code and id, kind, whether it is approved and if not why, its text as the spec owner reads it, its fields (an items field as codes), its references and dependencies by code (another module's as \"Module name/CODE\"), what makes it out of date, which items it makes out of date, who signed it, what its last signature covered where that differs from it now (sinceSigned), and its open thread. Read without items to also get the stage's coverages and impacts. Pass items, as codes or ids, to read only those. Pass module to read a stage of another module without opening it, such as to mention one of its items: the codes are then that module's, written \"Module name/CODE\" from the open module, and the codesVersion is that module's.",
    inputSchema: {
      type: "object",
      properties: {
        stage: STAGE_PROPERTY,
        items: { type: "array", items: { type: "string" }, description: "Codes or ids of the items to read; all of the stage's items when left out." },
      },
      required: ["stage"],
      additionalProperties: false,
    },
  },
  inModule: true,
  run: (store, args) => {
    const stage = stageNamed(store, args.stage);
    const all = store.itemsOf(stage).map(({ id }) => id);
    const wanted = optionalStrings(args, "items", "get_items");
    const chosen = wanted == null
      ? all
      : wanted.map((name) => {
          const id = store.itemNamed(name);
          if (id == null || !all.includes(id)) throw new UserFacingError(`${store.stageLabel(stage)} has no item ${name}.`);
          return id;
        });
    return JSON.stringify({
      stage,
      codesVersion: store.codesVersion,
      items: chosen.map((id) => itemView(store, id)),
      ...(wanted == null ? coverageAndImpactViews(store, stage) : {}),
    });
  },
};

const threadTool: AgentTool = {
  inModule: true,
  makes: null,
  description: {
    name: "get_thread",
    description:
      "Read one thread, open or resolved: whom it waits for; what it is on, a unit or the stage itself, and for a thread opened by asking for its stage to be written or reviewed, what it asks; every message, with who wrote it, when, and the findings it gives, each with its item, the rule and how, and whether the item changed since; for an item, the item as get_items gives it; for a removed unit, what it said when it was removed (removedUnitText), by which a reply names it. A marked mention in a message reads [CODE](item:ID), by the item's code now, or as [removed item](item:ID) once its item is gone; any other code in a message is plain text. A channel event about a thread assigned to you names the thread.",
    inputSchema: {
      type: "object",
      properties: { threadId: { type: "string", description: "The thread to read." } },
      required: ["threadId"],
      additionalProperties: false,
    },
  },
  run: (store, args, open, _caller, agent) => {
    const threadId = stringArgument(args, "threadId");
    const thread = store.threads.find(({ id }) => id === threadId);
    if (thread == null) throw new UserFacingError(`There is no thread ${threadId}.`);
    const text = JSON.stringify(threadWithUnit(store, thread, statusOf(open, agent)));
    return text;
  },
};

const threadsTool: AgentTool = {
  inModule: true,
  makes: null,
  description: {
    name: "get_threads",
    description:
      "Read every thread of the module, open and resolved, with all their messages and their findings and, for an item, the item as get_items gives it, oldest first; pass a stage to read only its threads, including those on the stage itself and those whose unit was removed. Messages read as in get_thread.",
    inputSchema: { type: "object", properties: { stage: STAGE_PROPERTY }, additionalProperties: false },
  },
  run: (store, args, open, _caller, agent) => {
    const threads = args.stage == null ? store.threads : store.threadsOfStage(stageNamed(store, args.stage));
    return JSON.stringify(threads.map((thread) => threadWithUnit(store, thread, statusOf(open, agent))));
  },
};

const ANSWERS_PROPERTY = {
  type: "array",
  description:
    `The open threads assigned to you that these changes answer, each with a reply telling the spec owner what changed, and the findings it gives. get_workflow_state lists them. Your reply ends the thread's assignment to you. A thread in a stage these changes close is answered once that stage is open again. The codes of marked mentions are those of the codesVersion you send, before this write. ${replyRulesText()}`,
  items: {
    type: "object",
    properties: { threadId: { type: "string" }, reply: { type: "string", minLength: 1 }, findings: FINDINGS_PROPERTY },
    required: ["threadId", "reply"],
    additionalProperties: false,
  },
};

const writeTool: AgentTool = {
  inModule: true,
  makes: "write of items",
  description: {
    name: "write_items",
    description:
      "Write, change and remove items of any open stages, all or none, following the published rules of each kind of item, from get_stage_rules. Name items by the codes of the codesVersion you send. An item missing a required field, referencing none of a kind it must reference, or breaking a rule of its kind (such as a name another item already has, a value of the wrong type, or an operation a step does not offer), is refused with each problem; the rules are checked once all the changes are applied, so their order does not matter. One write never changes a stage together with a stage that builds on it: change the earlier stage, and the later one once the earlier is complete again. Items added in one write cannot name each other by code: write an item, then those that choose it. An added or changed item rests on the current versions of what it references and depends on; an item changed to exactly what it was stays as it was. Removing a signed item proposes its removal, which the spec owner signs; an item never signed is removed at once. Changing an item proposed for removal withdraws the removal, even when the change leaves it exactly as it was. A reference links to an item of a stage this stage builds on; a dependency links to an item of the same stage, or of another module as \"Module name/CODE\" in the same stage or one it builds on. The reply names each item by the code you named it by, with its new code where that moved, and an added item by its new code. Pass answers to reply, with findings, to the threads assigned to you that these changes answer, and pointTo to point the spec owner to one item, coverage or impact that needs them. Only the spec owner signs and resolves threads.",
    inputSchema: {
      type: "object",
      properties: {
        codesVersion: { type: "string", description: "The codesVersion of the get_items or get_workflow_state read the codes come from." },
        changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["add", "change", "remove"] },
              stage: { type: "string", description: "For add: the stage id." },
              kind: { type: "string", description: "For add: the kind of item, when the stage holds several." },
              item: { type: "string", description: "For change and remove: the item's code." },
              fields: {
                type: "object",
                description: "For add and change: the item's fields by name, as get_stage_rules lists them: a text or choice field as text, a flag as true or false, a texts field as a list of texts, an items field as a list of codes, or one code when single, a record field as an object of its fields, a records field as a list of such objects, items fields within them as codes too; such as a user story's {\"targetUsers\": [\"USR-01\"], \"outcome\": \"…\", \"reason\": \"…\", \"priority\": \"P1\"}. get_stage_rules gives an example of the fields of an operation and of an abstract test. null empties an optional field. A change replaces only the fields it names, a records field as a whole.",
              },
              references: { type: "array", items: { type: "string" }, description: "Codes of the items it references, besides those its items fields choose; a change replaces them all." },
              dependencies: { type: "array", items: { type: "string" }, description: "Codes of the items it depends on; a change replaces them all." },
            },
            required: ["action"],
            additionalProperties: false,
          },
        },
        answers: ANSWERS_PROPERTY,
        pointTo: POINTER_PROPERTY,
      },
      required: ["codesVersion", "changes"],
      additionalProperties: false,
    },
  },
  run: (store, args, open, caller, agent) => {
    requireCodesVersion(store, args);
    const changes = parseChanges(store, args.changes);
    const answers = parseAnswers(store, args.answers, args.codesVersion, changes);
    const pointer = parsePointer(store, open, args.pointTo, changes);
    const found = deskOf(open);
    if (found != null && agent != null) {
      const stages = stagesChangedBy(store, changes);
      const othersHold = found.desk.heldThreads().some((waiting) => waiting.moduleId === found.moduleId && waiting.agentId !== agent.id);
      const problems = found.desk.writeProblems(agent.id, {
        moduleId: found.moduleId,
        stages,
        closes: othersHold && changes.length > 0 ? stagesClosedBy(store, changes) : [],
        answers: answers.map(({ threadId }) => threadId),
      });
      if (problems.length > 0) throw new UserFacingError(problems.join("\n"));
    } else if (answers.length > 0) {
      throw new UserFacingError("No thread is assigned to any agent in this project, so no write answers a thread. Add a message with reply_to_thread instead.");
    }
    // Each thread answered is one assigned to this agent, as the desk checked.
    const answered = answers.map(({ threadId }) => found!.desk.waitingIn(found!.moduleId, threadId)!);
    const versionBefore = store.codesVersion;
    const codesBefore = codesNow(store);
    const name = agent?.name ?? caller.name;
    const outcome = store.writeItems(changes, answers.length === 0 ? null : { answers, author: { kind: "agent", name } });
    for (const waiting of answered) found!.desk.answered(waiting.key);
    const lines = [
      ...outcomeLines(store, outcome, codesBefore),
      ...(answers.length > 0
        ? [`Replied to ${answers.length === 1 ? "one thread, answering it" : `${answers.length} threads, answering them`}; the spec owner reads the replies and resolves the threads.`]
        : []),
      ...(pointer == null ? [] : [pointOut(store, open, pointer, changes, outcome.added)]),
      "The spec owner signs these in Requireganizer; get_workflow_state shows what is signable.",
    ];
    if (store.codesVersion !== versionBefore) lines.push(`Codes may have moved (codesVersion ${store.codesVersion}): read get_items again before naming items.`);
    return lines.join("\n");
  },
};

const reorderTool: AgentTool = {
  inModule: true,
  makes: "write of items",
  description: {
    name: "reorder_items",
    description:
      "Put the items of one open stage in the order the page shows them, all or none. Name every item the stage holds, by code, once each, in the order you want, including one proposed for removal or waiting for impacts; get_items lists them. Reordering changes no item's fields, references, dependencies, version or signature, and needs no signature. Codes are positions, so a moved item may get another code: the reply names each item whose code changed. A reorder changes codesVersion; read get_items again before naming items or relying on their order.",
    inputSchema: {
      type: "object",
      properties: {
        codesVersion: { type: "string", description: "The codesVersion of the get_items or get_workflow_state read the codes come from." },
        stage: STAGE_PROPERTY,
        order: {
          type: "array",
          items: { type: "string" },
          description: "Every code of the stage's items, once each, in the order the page should show them.",
        },
      },
      required: ["codesVersion", "stage", "order"],
      additionalProperties: false,
    },
  },
  run: (store, args, open, _caller, agent) => {
    requireCodesVersion(store, args);
    const stage = stageNamed(store, args.stage);
    const found = deskOf(open);
    if (found != null && agent != null) {
      const problems = found.desk.writeProblems(agent.id, { moduleId: found.moduleId, stages: [stage], closes: [], answers: [] });
      if (problems.length > 0) throw new UserFacingError(problems.join("\n"));
    }
    const codes = optionalStrings(args, "order", "reorder_items");
    if (codes == null) throw new UserFacingError("order must be a list of codes.");
    const itemIds = codes.map((code) => {
      const id = store.itemNamed(code);
      if (id == null) throw new UserFacingError(`${store.stageLabel(stage)} has no item ${code}.`);
      return id;
    });
    const outcome = store.reorderItems(stage, itemIds);
    const label = store.stageLabel(stage);
    if (!outcome.reordered) return `${label} is already in that order.`;
    const moved = outcome.recoded.length === 0
      ? "No codes moved."
      : `Codes moved: ${outcome.recoded.map(({ before, after }) => `${before} → ${after}`).join(", ")}.`;
    return `Reordered ${label}. ${moved} codesVersion is now ${store.codesVersion}; read get_items again before naming items or relying on their order.`;
  },
};

const replyTool: AgentTool = {
  inModule: true,
  makes: "thread message",
  description: {
    name: "reply_to_thread",
    description:
      `Add a message to an open thread of an open stage, on a unit or on the stage itself, without changing items, such as to ask what the spec owner means, to say why the unit should stay as it is, or to answer a thread asking to review a stage with findings. A message of the agent the thread is assigned to answers it, which ends the assignment; any other agent's leaves it waiting with the agent it is assigned to, and may give no findings. To answer with changes, use write_items with answers. Pass pointTo to point the spec owner to a set of items, coverages and impacts that need them. Only the spec owner resolves a thread. ${replyRulesText()}`,
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "The thread to reply to, from get_workflow_state or get_thread." },
        text: { type: "string", minLength: 1, description: "The reply the spec owner reads." },
        codesVersion: { type: "string", description: "The codesVersion of the get_items or get_workflow_state read the codes of the reply's marked mentions come from; needed when it holds one." },
        findings: FINDINGS_PROPERTY,
        pointTo: POINTER_PROPERTY,
      },
      required: ["threadId", "text"],
      additionalProperties: false,
    },
  },
  run: (store, args, open, caller, agent) => {
    const reply = parseReply(store, stringArgument(args, "threadId"), stringArgument(args, "text"), args.codesVersion, []);
    const findings = parseFindings(store, args.findings, "The reply");
    const pointer = parsePointer(store, open, args.pointTo, []);
    const thread = store.threads.find(({ id }) => id === reply.threadId);
    // Only the agent the thread is assigned to answers it, and only it gives findings; any other agent's message leaves it waiting.
    const answering = thread == null ? null : heldByCaller(open, agent, thread);
    if (findings.length > 0 && answering == null) {
      throw new UserFacingError(`Thread ${reply.threadId} is not assigned to you, so you may add a message to it but give no findings.`);
    }
    const name = agent?.name ?? caller.name;
    const annotations = findingsAnnotation(findings);
    store.answerThreads([annotations == null ? reply : { ...reply, annotations }], { kind: "agent", name });
    if (answering != null) deskOf(open)!.desk.answered(answering.key);
    return [
      answering == null ? "Replied. If the thread waits for an agent, it still does." : "Replied, answering the thread; it no longer waits for an agent, and the spec owner reads your reply.",
      ...(pointer == null ? [] : [pointOut(store, open, pointer, [], [])]),
    ].join("\n");
  },
};

const createModuleTool: AgentTool = {
  makes: "module change",
  description: {
    name: "create_module",
    description:
      "Create a module the spec owner asked for, empty at its first stage. The spec owner's page stays where it is; pass module with the new module's name to read and write it.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", minLength: 1, description: "The module's name, as the spec owner gave it." } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  run: (_store, args, open) => {
    const name = stringArgument(args, "name");
    open.addModule!(name);
    return `Created the module. Pass module: "${name.trim()}" to work on it; call get_workflow_state with it first.`;
  },
};

/** The one tool a coding agent that has no name may call. */
const NAME_TOOL = "name_yourself";

/** What a coding agent that has no name is told, as it connects and whenever it calls another tool. */
export const NAME_YOURSELF_TEXT =
  `Before anything else, give yourself a name with ${NAME_TOOL}: take it from your conversation with your user, or ask your user for one when that conversation gives none. The spec owner assigns each thread to an agent by its name.`;

const nameYourselfTool: AgentTool = {
  makes: null,
  description: {
    name: NAME_TOOL,
    description: `Give yourself the name the spec owner assigns you threads by, once, as you connect. ${NAME_YOURSELF_TEXT} A name is refused when it is empty or another available agent has it, letters of either case counting as the same.`,
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", minLength: 1, description: "Your name, such as the one your user calls you by." } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  run: (_store, args, open, caller) => {
    if (open.desk == null || caller.connection == null) throw new UserFacingError("Only a connected coding agent names itself.");
    const name = stringArgument(args, "name");
    open.desk.roster.nameCodingAgent(caller.connection, name);
    return `You are “${name.trim()}”. The spec owner can now assign you threads; each one assigned to you arrives as a channel event. Call get_workflow_state to start.`;
  },
};

const reportCannotAnswerTool: AgentTool = {
  inModule: false,
  assigned: { argument: "id" },
  makes: null,
  description: {
    name: "report_cannot_answer",
    description:
      "Report that you cannot answer a thread assigned to you, with a text saying why, such as a question only the spec owner can settle. The thread is then no agent's and still waits for an agent; the spec owner sees your text with it until they assign it again. Pass the id field that get_workflow_state or the channel event gives with the thread, not its thread_id.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The id field get_workflow_state or the channel event gives with the thread you cannot answer, not its thread_id." },
        reason: { type: "string", minLength: 1, description: "Why you cannot answer it, for the spec owner." },
      },
      required: ["id", "reason"],
      additionalProperties: false,
    },
  },
  run: (_store, args, open, _caller, agent, assigned) => {
    const found = deskOf(open);
    if (found == null || agent == null) throw new UserFacingError("No thread is assigned to any agent in this project.");
    if (assigned == null) throw new UserFacingError("Pass the id get_workflow_state or the channel event gives with the thread you cannot answer.");
    found.desk.fail(assigned.key, agent.id, stringArgument(args, "reason"));
    return "Reported. The thread is no agent's now and waits for the spec owner to assign it again.";
  },
};

const READ_TOOLS: readonly AgentTool[] = [workflowStateTool, stageRulesTool, itemsTool, threadTool, threadsTool];

function toolsFor(open: OpenModule): AgentTool[] {
  return [
    ...(open.desk == null ? [] : [nameYourselfTool]),
    ...READ_TOOLS,
    writeTool,
    reorderTool,
    replyTool,
    ...(open.desk == null ? [] : [reportCannotAnswerTool]),
    ...(open.addModule == null ? [] : [createModuleTool]),
  ];
}

function toolNamed(name: string, open: OpenModule): AgentTool {
  const tool = toolsFor(open).find(({ description }) => description.name === name);
  if (tool == null) throw new UserFacingError(`No tool named ${name} is available now.`);
  return tool;
}

/** The kind of change a call of the tool makes, as its step names it; null for a tool that only reads. */
export function agentToolChange(name: string, open: OpenModule = {}): ChangeKind | null {
  return toolNamed(name, open).makes;
}

/** The read tools, which an agent can call in every state of the project. */
export function readToolDescriptions(): AgentToolDescription[] {
  return READ_TOOLS.map((tool) => describedTool(tool, {}));
}

/**
 * The tools an agent works with on an open project. Signing and resolving
 * threads stay with the spec owner, so no tool does either.
 */
export function agentToolDescriptions(open: OpenModule = {}): AgentToolDescription[] {
  return toolsFor(open).map((tool) => describedTool(tool, open));
}

const MODULE_PROPERTY = {
  type: "string",
  description: "Another module to work on, as get_workflow_state lists it under otherModules; the module the spec owner has open when left out. Its codes and codesVersion are that module's. Working on it does not move the spec owner's page.",
};

/** A tool as it is listed: one that works on any module takes module while the project has other modules. */
function describedTool(tool: AgentTool, open: OpenModule): AgentToolDescription {
  if (!tool.inModule || open.otherModule == null) return tool.description;
  const schema = tool.description.inputSchema as { properties?: Record<string, unknown> };
  return { ...tool.description, inputSchema: { ...schema, properties: { ...schema.properties, module: MODULE_PROPERTY } } };
}

/**
 * Run a tool on the module of the assigned thread it names, if it names
 * one, else on the module `args.module` names, else on the open one; another
 * module is read as it is, or changed without being shown.
 */
function runInModule(
  tool: AgentTool,
  shown: Store,
  args: Arguments,
  open: OpenModule,
  caller: AgentCaller,
  agent: CallingAgent | null,
  assigned: WaitingThread | null,
): string {
  const { module: named, ...rest } = args;
  if (named != null && typeof named !== "string") throw new UserFacingError("module must be a module's name.");
  if (assigned?.moduleName != null && named != null && named !== assigned.moduleName) {
    throw new UserFacingError(`The thread this call is about is in module “${assigned.moduleName}”, not “${named}”.`);
  }
  const name = assigned?.moduleName ?? named ?? null;
  if (!tool.inModule && assigned == null) return tool.run(shown, rest, open, caller, agent, assigned);
  if (assigned != null && assigned.moduleId === open.moduleId) return tool.run(shown, rest, open, caller, agent, assigned);
  if (assigned != null && name == null) throw new UserFacingError("The thread this call is about is in a module this call cannot reach.");
  if (name == null || name === open.moduleName) return tool.run(shown, rest, open, caller, agent, assigned);
  if (open.otherModule == null) throw new UserFacingError("This project has no other module.");
  const other = open.otherModule(name);
  const scoped: OpenModule = { ...open, moduleName: other.name, moduleId: other.id };
  const run = (store: Store) => tool.run(store, rest, scoped, caller, agent, assigned);
  return tool.makes == null ? run(other.store) : other.change(run);
}

/**
 * The agent calling, as the desk knows it: a coding agent is its
 * connection, known from its first call until the connection ends; one
 * that has no name may only name itself.
 */
function callingAgent(open: OpenModule, caller: AgentCaller, toolName: string): CallingAgent | null {
  const { desk } = open;
  if (desk == null) return null;
  if (caller.agentId != null) {
    const name = desk.roster.nameOf(caller.agentId);
    if (name == null) throw new UserFacingError("This agent is no longer available.");
    return { id: caller.agentId, name };
  }
  if (caller.connection == null) throw new UserFacingError("Only an agent of this project calls its tools.");
  desk.roster.connect(caller.connection);
  const id = codingAgentId(caller.connection);
  const name = desk.roster.nameOf(id);
  if (name == null && toolName !== NAME_TOOL) throw new UserFacingError(`You have no name yet, so nothing else is open to you. ${NAME_YOURSELF_TEXT}`);
  return name == null ? null : { id, name };
}

/**
 * Run one tool for an agent, synchronously, so the host can take the call
 * as one change. Throws a message the agent can act on when the call fails.
 */
export function callAgentTool(
  store: Store,
  name: string,
  args: Arguments,
  open: OpenModule = {},
  caller: AgentCaller = { name: "The coding agent" },
): string {
  const tool = toolNamed(name, open);
  const agent = callingAgent(open, caller, name);
  const assigned = assignedNamedBy(tool, args, open, agent);
  const result = runInModule(tool, store, args, open, caller, agent, assigned);
  // What the call answered or withdrew is no agent's, even if undo makes it wait again.
  open.desk?.settle();
  return result;
}
