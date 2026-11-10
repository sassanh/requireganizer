import { UserFacingError } from "lib/errors";
import { isRecord } from "lib/json";
import type { Store } from "store";
import {
  authorLabel,
  type ChangeOutcome,
  chosenItems,
  type FieldDefinition,
  type ItemChange,
  type ItemContent,
  type ItemVersion,
  LINK_REASON_LABELS,
  mapItemsFields,
  NOT_APPROVED_REASON_LABELS,
  parseUnitId,
  signerLabel,
  STAGE_PROGRESS_LABELS,
  type Thread,
  type ThreadAnswer,
  waitsForAnswerer,
} from "workflow";

type RecordContent = ItemContent;

/** A tool an outside agent can call, as a tool protocol lists it. */
export interface AgentToolDescription {
  name: string;
  description: string;
  /** JSON Schema of the tool's arguments: always an object schema. */
  inputSchema: Record<string, unknown>;
}

/**
 * What an outside agent works on: the module the person has open, named
 * while the project has modules, and then how to switch to another or add
 * one.
 */
export interface OpenModule {
  moduleName?: string;
  switchModule?: (name: string) => string;
  addModule?: (name: string) => void;
}

/** The outside agent calling: the name it gave when it connected. */
export interface AgentCaller {
  name: string;
  /** The connection it calls through, set by the host; what the agent takes up ends with it. */
  connection?: string;
}

type Arguments = Record<string, unknown>;

interface AgentTool {
  description: AgentToolDescription;
  run(store: Store, args: Arguments, open: OpenModule, caller: AgentCaller): string;
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
  return store.namedItem(id)?.name ?? `a removed item (${id})`;
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

function threadView(store: Store, thread: Thread): Record<string, unknown> {
  return {
    threadId: thread.id,
    unit: store.unitLabel(thread.unitId),
    stage: thread.stage,
    status: thread.resolution != null ? "resolved" : waitsForAnswerer(thread) ? "waiting for you" : "waiting for the spec owner",
    messages: thread.messages.map(({ author, text, withChanges }) => ({
      from: author.kind === "person" ? "spec owner" : authorLabel(author),
      text,
      ...(withChanges ? { withChanges } : {}),
    })),
  };
}

/** A thread with the item it is on, as get_items gives it, or that its unit is gone. */
function threadWithUnit(store: Store, thread: Thread): Record<string, unknown> {
  const address = parseUnitId(thread.unitId);
  const isItem = address.kind === "item" && store.itemState(address.itemId) != null;
  return {
    ...threadView(store, thread),
    ...(thread.removedUnit == null ? {} : { unitRemoved: true }),
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
  const own = store.itemNamed(name);
  if (own != null) return own;
  const separator = name.lastIndexOf("/");
  if (allowOtherModules && separator > 0) {
    const moduleName = name.slice(0, separator);
    const linked = store.linkedModules.find((candidate) => candidate.name === moduleName);
    if (linked == null) throw new UserFacingError(`${label}: there is no other module named ${moduleName}.`);
    const id = linked.lookup.itemNamed(name.slice(separator + 1));
    if (id == null) throw new UserFacingError(`${label}: ${moduleName} has no item ${name.slice(separator + 1)}.`);
    return id;
  }
  throw new UserFacingError(`${label}: this module has no item ${name}.`);
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

function parseAnswers(value: unknown): ThreadAnswer[] {
  if (value == null) return [];
  if (
    !Array.isArray(value) ||
    !value.every((entry) => isRecord(entry) && typeof entry.threadId === "string" && typeof entry.reply === "string")
  ) {
    throw new UserFacingError("answers must be a list of { threadId, reply }.");
  }
  return value.map(({ threadId, reply }: { threadId: string; reply: string }) => ({ threadId, text: reply }));
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

const workflowStateTool: AgentTool = {
  description: {
    name: "get_workflow_state",
    description:
      "Get the module the spec owner has open and its workflow state: whether every stage is complete, and for each stage whether it is open (every stage it builds on is complete, so it can be written, signed and discussed) or closed, its progress (empty, in progress, complete), how many of its items, coverages and impacts are approved out of how many, what in it waits for a signature, and its open threads. threadsWaitingForYou lists the change requests that wait for your answer; stagesWaitingForYou lists the stages the spec owner asks you to write next. Items are named by the codes of codesVersion.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  run: (store, _args, open) => {
    const stages = store.workflow.stageIds.map((stage) => {
      const summary = store.stageSummary(stage);
      const definition = store.workflow.stage(stage);
      return {
        stage,
        label: definition.label,
        buildsOn: definition.buildsOn.map((basis) => basis.stage),
        state: summary.open ? "open" : "closed",
        progress: STAGE_PROGRESS_LABELS[summary.progress],
        approved: `${summary.approved} of ${summary.total}`,
        waitingForSignature: summary.waiting,
        openThreads: store.threadsOfStage(stage).filter(({ resolution }) => resolution == null).map((thread) => threadView(store, thread)),
      };
    });
    return JSON.stringify({
      ...(open.moduleName == null ? {} : { module: open.moduleName }),
      otherModules: store.linkedModules.map(({ name }) => name),
      codesVersion: store.codesVersion,
      complete: store.isComplete,
      stages,
      threadsWaitingForYou: store.threadsWaitingForAnswerer.map((thread) => ({
        threadId: thread.id,
        unit: store.unitLabel(thread.unitId),
        stage: thread.stage,
      })),
      stagesWaitingForYou: store.writingAskedOfAnswerer.map(({ stage }) => ({ stage, label: store.workflow.stage(stage).label })),
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
  description: {
    name: "get_stage_rules",
    description:
      "Read one stage's published rules, the same the spec owner reads and signs against: what it builds on and which kinds of items it covers there, the kinds of item it holds with their codes, fields, the kinds each must reference at least one of, the single items each counts as referencing or depending on without listing them, an example of its fields where the shape is not plain, the rules every item of it follows, as a list, and, for some stages, examples of what follows them and what does not. Each field has a type: text; choice, one of its options; flag, true or false; texts, a list of texts; items, a list of codes of the kind it chooses, or one code, never a list, when single, which count as the item's references when that kind is in a stage this stage builds on, or as its dependencies when it is in this stage, and are never listed again in references or dependencies; record, an object of its own fields, or null for none; records, a list of such objects, one per entry. A field with shownAfter holds only what follows those words. A refused write names the field by its place, such as \"AT-01, Then step 2: Comparison\". Read them before writing a stage.",
    inputSchema: { type: "object", properties: { stage: STAGE_PROPERTY }, required: ["stage"], additionalProperties: false },
  },
  run: (store, args) => {
    const stage = store.workflow.stage(stageNamed(store, args.stage));
    return JSON.stringify({
      stage: stage.id,
      label: stage.label,
      buildsOn: stage.buildsOn.map(({ stage: basis, covers }) => ({ stage: basis, covers })),
      kinds: stage.kinds.map((kind) => ({
        kind: kind.kind,
        label: kind.label,
        code: kind.code,
        ...(kind.single ? { single: true } : {}),
        fields: kind.fields.map(fieldView),
        ...(kind.mustReference == null ? {} : { mustReferenceAtLeastOne: kind.mustReference }),
        ...(kind.referencesSingle == null ? {} : { countsAsReferencing: kind.referencesSingle }),
        ...(kind.dependsOnSingle == null ? {} : { countsAsDependingOn: kind.dependsOnSingle }),
        ...(kind.example == null ? {} : { exampleFields: kind.example }),
      })),
      rules: store.workflow.rulesOf(stage.id),
      ...(stage.examples == null ? {} : { examples: stage.examples }),
    });
  },
};

const itemsTool: AgentTool = {
  description: {
    name: "get_items",
    description:
      "List one stage's items in the order the page shows them, with the codesVersion a write naming them by code sends back: each with its code and id, kind, whether it is approved and if not why, its text as the spec owner reads it, its fields (an items field as codes), its references and dependencies by code (another module's as \"Module name/CODE\"), what makes it out of date, which items it makes out of date, who signed it, what its last signature covered where that differs from it now (sinceSigned), and its open thread. Read without items to also get the stage's coverages and impacts. Pass items, as codes or ids, to read only those.",
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
  description: {
    name: "get_thread",
    description:
      "Read one thread, open or resolved: whom it waits for, every message, and its unit; for an item, the item as get_items gives it. A channel event about a change request names its thread. Reading a thread that waits for you shows the spec owner you are working on it, until you answer or they write again.",
    inputSchema: {
      type: "object",
      properties: { threadId: { type: "string", description: "The thread to read." } },
      required: ["threadId"],
      additionalProperties: false,
    },
  },
  run: (store, args, _open, caller) => {
    const threadId = stringArgument(args, "threadId");
    const thread = store.threads.find(({ id }) => id === threadId);
    if (thread == null) throw new UserFacingError(`There is no thread ${threadId}.`);
    const text = JSON.stringify(threadWithUnit(store, thread));
    store.takeUpThread(threadId, caller.connection ?? caller.name);
    return text;
  },
};

const threadsTool: AgentTool = {
  description: {
    name: "get_threads",
    description:
      "Read every thread of the module, open and resolved, with all their messages and, for an item, the item as get_items gives it, oldest first; pass a stage to read only its threads, including those whose unit was removed.",
    inputSchema: { type: "object", properties: { stage: STAGE_PROPERTY }, additionalProperties: false },
  },
  run: (store, args) => {
    const threads = args.stage == null ? store.threads : store.threadsOfStage(stageNamed(store, args.stage));
    return JSON.stringify(threads.map((thread) => threadWithUnit(store, thread)));
  },
};

const ANSWERS_PROPERTY = {
  type: "array",
  description:
    "The open threads these changes answer, each with a reply telling the spec owner what changed. get_workflow_state lists them. A thread in a stage these changes close is answered once that stage is open again.",
  items: {
    type: "object",
    properties: { threadId: { type: "string" }, reply: { type: "string", minLength: 1 } },
    required: ["threadId", "reply"],
    additionalProperties: false,
  },
};

const writeTool: AgentTool = {
  description: {
    name: "write_items",
    description:
      "Write, change and remove items of any open stages, all or none, following each stage's published rules from get_stage_rules. Name items by the codes of the codesVersion you send. An item missing a required field, referencing none of a kind it must reference, or breaking a rule of its kind (such as a name another item already has, a value of the wrong type, or an operation a step does not offer), is refused with each problem; the rules are checked once all the changes are applied, so their order does not matter. One write never changes a stage together with a stage that builds on it: change the earlier stage, and the later one once the earlier is complete again. Items added in one write cannot name each other by code: write an item, then those that choose it. An added or changed item rests on the current versions of what it references and depends on; an item changed to exactly what it was stays as it was. Removing a signed item proposes its removal, which the spec owner signs; an item never signed is removed at once. A reference links to an item of a stage this stage builds on; a dependency links to an item of the same stage, or of another module as \"Module name/CODE\" in the same stage or one it builds on. The reply names each item by the code you named it by, with its new code where that moved, and an added item by its new code. Pass answers to reply to the threads these changes answer. Only the spec owner signs and resolves threads.",
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
      },
      required: ["codesVersion", "changes"],
      additionalProperties: false,
    },
  },
  run: (store, args, _open, caller) => {
    requireCodesVersion(store, args);
    const answers = parseAnswers(args.answers);
    const changes = parseChanges(store, args.changes);
    const versionBefore = store.codesVersion;
    const codesBefore = codesNow(store);
    const outcome = store.writeItems(changes, answers);
    if (answers.length > 0) store.answerThreads(answers, { kind: "agent", name: caller.name }, changes.length > 0);
    const lines = [
      ...outcomeLines(store, outcome, codesBefore),
      ...(answers.length > 0
        ? [`Replied to ${answers.length === 1 ? "one thread" : `${answers.length} threads`}; the spec owner reads the replies and resolves the threads.`]
        : []),
      "The spec owner signs these in Requireganizer; get_workflow_state shows what waits for a signature.",
    ];
    if (store.codesVersion !== versionBefore) lines.push(`Codes may have moved (codesVersion ${store.codesVersion}): read get_items again before naming items.`);
    return lines.join("\n");
  },
};

const reorderTool: AgentTool = {
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
  run: (store, args) => {
    requireCodesVersion(store, args);
    const stage = stageNamed(store, args.stage);
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

const switchModuleTool: AgentTool = {
  description: {
    name: "switch_module",
    description:
      "Open another module of the project, so the spec owner's page and every tool work on it. Name it as get_workflow_state lists it under module or otherModules. The page switches at once. Call get_workflow_state after switching: each module has its own stages, items and codesVersion.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, description: "The module to open, as get_workflow_state lists it." },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  run: (_store, args, open) => {
    const requested = stringArgument(args, "name");
    const opened = open.switchModule!(requested);
    if (opened === open.moduleName) return `“${opened}” is already open.`;
    return `Opened “${opened}”. Every tool now works on it; call get_workflow_state before working on it.`;
  },
};

const replyTool: AgentTool = {
  description: {
    name: "reply_to_thread",
    description:
      "Reply to an open thread without changing items, such as to ask what the spec owner means or to say why the unit should stay as it is. To answer with changes, use write_items with answers. Only the spec owner resolves a thread.",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "The thread to reply to, from get_workflow_state or get_thread." },
        text: { type: "string", minLength: 1, description: "The reply the spec owner reads." },
      },
      required: ["threadId", "text"],
      additionalProperties: false,
    },
  },
  run: (store, args, _open, caller) => {
    store.answerThreads([{ threadId: stringArgument(args, "threadId"), text: stringArgument(args, "text") }], { kind: "agent", name: caller.name });
    return "Replied. The thread waits for the spec owner.";
  },
};

const createModuleTool: AgentTool = {
  description: {
    name: "create_module",
    description:
      "Create a module the spec owner asked for. It opens at once in Requireganizer, empty at its first stage, and every tool then works on it.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", minLength: 1, description: "The module's name, as the spec owner gave it." } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  run: (_store, args, open) => {
    open.addModule!(stringArgument(args, "name"));
    return "Created the module; it is now the one the spec owner has open. Call get_workflow_state before working on it.";
  },
};

const READ_TOOLS: readonly AgentTool[] = [workflowStateTool, stageRulesTool, itemsTool, threadTool, threadsTool];

function toolsFor(open: OpenModule): AgentTool[] {
  return [
    ...READ_TOOLS,
    writeTool,
    reorderTool,
    replyTool,
    ...(open.switchModule == null ? [] : [switchModuleTool]),
    ...(open.addModule == null ? [] : [createModuleTool]),
  ];
}

/** The read tools, which an outside agent can call in every state of the project. */
export function readToolDescriptions(): AgentToolDescription[] {
  return READ_TOOLS.map(({ description }) => description);
}

/**
 * The tools an outside agent works with on an open project. Signing and
 * resolving threads stay with the spec owner, so no tool does either.
 */
export function agentToolDescriptions(open: OpenModule = {}): AgentToolDescription[] {
  return toolsFor(open).map(({ description }) => description);
}

/**
 * Run one tool for an outside agent, synchronously, so the host can take the
 * call as one change. Throws a message the agent can act on when the call
 * fails.
 */
export function callAgentTool(
  store: Store,
  name: string,
  args: Arguments,
  open: OpenModule = {},
  caller: AgentCaller = { name: "The coding agent" },
): string {
  const tool = toolsFor(open).find(({ description }) => description.name === name);
  if (tool == null) throw new UserFacingError(`No tool named ${name} is available now.`);
  return tool.run(store, args, open, caller);
}
