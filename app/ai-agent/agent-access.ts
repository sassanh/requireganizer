import { UserFacingError } from "lib/errors";
import { isRecord } from "lib/json";
import type { Store } from "store";
import {
  authorLabel,
  type ChangeOutcome,
  type ItemChange,
  type ItemContent,
  type ItemVersion,
  LINK_REASON_LABELS,
  NOT_APPROVED_REASON_LABELS,
  parseUnitId,
  signerLabel,
  STAGE_PROGRESS_LABELS,
  type Thread,
  type ThreadAnswer,
  waitsForAnswerer,
} from "workflow";

/** A tool an outside agent can call, as a tool protocol lists it. */
export interface AgentToolDescription {
  name: string;
  description: string;
  /** JSON Schema of the tool's arguments: always an object schema. */
  inputSchema: Record<string, unknown>;
}

/**
 * What an outside agent works on: the module the person has open, named
 * while the project has modules, and then how to add one.
 */
export interface OpenModule {
  moduleName?: string;
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

/** How a dependency is named to the agent: by code in this module, or as "Module name/CODE" in another. */
function linkName(store: Store, id: string): string {
  const own = store.codeOf(id);
  if (own != null) return own;
  for (const linked of store.linkedModules) {
    const code = linked.lookup.codeOf(id);
    if (code != null) return `${linked.name}/${code}`;
  }
  return `a removed item (${id})`;
}

function versionView(store: Store, version: ItemVersion): Record<string, unknown> {
  return {
    fields: version.content,
    references: version.references.map((id) => linkName(store, id)),
    dependencies: version.dependencies.map((id) => linkName(store, id)),
  };
}

/** One item as an agent works with it: its code, state, fields and links by code, and what changed since it was signed. */
function itemView(store: Store, id: string): Record<string, unknown> {
  const state = store.itemState(id)!;
  const now = versionView(store, state.version);
  const signed = state.signature == null ? null : versionView(store, state.signature.version);
  const sinceSigned: Record<string, unknown> = {};
  if (signed != null && !state.signatureCounts) {
    for (const key of ["fields", "references", "dependencies"] as const) {
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
    status: thread.resolvedAt != null ? "resolved" : waitsForAnswerer(thread) ? "waiting for you" : "waiting for the spec owner",
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
  const impacts = store.impactStates(stage).map((impact) => ({
    unit: store.unitLabel(impact.unitId),
    approved: impact.approved,
    ...(impact.approved ? {} : { notApprovedBecause: impact.reasons.map((reason) => NOT_APPROVED_REASON_LABELS[reason]) }),
    before: versionView(store, impact.before),
    after: impact.after == null ? "removed" : versionView(store, impact.after),
    ...(impact.openThread == null ? {} : { openThreadId: impact.openThread.id }),
  }));
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

function parseFields(value: unknown, label: string): Partial<ItemContent> | undefined {
  if (value == null) return undefined;
  if (!isRecord(value) || !Object.values(value).every((field) => field === null || typeof field === "string")) {
    throw new UserFacingError(`${label}: fields must map field names to text or null.`);
  }
  return value as Partial<ItemContent>;
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
      const fields = parseFields(entry.fields, label);
      switch (entry.action) {
        case "add": {
          const stage = stageNamed(store, entry.stage);
          const kinds = store.workflow.stage(stage).kinds;
          const kind = entry.kind ?? (kinds.length === 1 ? kinds[0]!.kind : undefined);
          if (typeof kind !== "string") {
            throw new UserFacingError(`${label}: name the kind, one of ${kinds.map(({ kind: name }) => name).join(", ")}.`);
          }
          return [{ type: "add", stage, kind, content: (fields ?? {}) as ItemContent, references: references ?? [], dependencies: dependencies ?? [] }];
        }
        case "change":
          return [{ type: "change", item: resolveLink(store, stringArgument(entry, "item"), false, label), content: fields, references, dependencies }];
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

function outcomeLines(store: Store, outcome: ChangeOutcome): string[] {
  const named = (ids: string[]) => ids.map((id) => store.codeOf(id) ?? id).join(", ");
  return [
    ...(outcome.added.length === 0 ? [] : [`Added: ${named(outcome.added)}.`]),
    ...(outcome.changed.length === 0 ? [] : [`Changed: ${named(outcome.changed)}.`]),
    ...(outcome.removalWithdrawn.length === 0 ? [] : [`Removal withdrawn: ${named(outcome.removalWithdrawn)}.`]),
    ...(outcome.proposedForRemoval.length === 0 ? [] : [`Proposed for removal, waiting for the spec owner's signature: ${named(outcome.proposedForRemoval)}.`]),
    ...(outcome.deleted.length === 0 ? [] : [`Removed at once, never signed: ${outcome.deleted.map(({ label }) => label).join(", ")}.`]),
    ...(outcome.unchanged.length === 0 ? [] : [`Left as they were, since nothing in them changed: ${named(outcome.unchanged)}.`]),
  ];
}

const STAGE_PROPERTY = { type: "string", description: "A stage id, as get_workflow_state lists them." };

const workflowStateTool: AgentTool = {
  description: {
    name: "get_workflow_state",
    description:
      "Get the module the spec owner has open and its workflow state: whether every stage is complete, and for each stage whether it is open (every stage it builds on is complete, so it can be written, signed and discussed) or closed, its progress (empty, in progress, complete), how many of its items, coverages and impacts are approved out of how many, what in it waits for a signature, and its open threads. threadsWaitingForYou lists the change requests that wait for your answer. Items are named by the codes of codesVersion.",
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
        openThreads: store.threadsOfStage(stage).filter(({ resolvedAt }) => resolvedAt == null).map((thread) => threadView(store, thread)),
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
    });
  },
};

const stageRulesTool: AgentTool = {
  description: {
    name: "get_stage_rules",
    description:
      "Read one stage's published rules, the same the spec owner reads and signs against: what it builds on and which kinds of items it covers there, the kinds of item it holds with their codes and fields, and the rules every item of it follows. Read them before writing a stage.",
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
        code: kind.code,
        ...(kind.single ? { single: true } : {}),
        fields: kind.fields.map(({ name, type, required }) => ({ name, type, required })),
      })),
      rules: stage.rules,
    });
  },
};

const itemsTool: AgentTool = {
  description: {
    name: "get_items",
    description:
      "List one stage's items in the order the page shows them, with the codesVersion a write naming them by code sends back: each with its code and id, kind, whether it is approved and if not why, its fields, its references and dependencies by code (another module's as \"Module name/CODE\"), what makes it out of date, which items it makes out of date, who signed it, what its last signature covered where that differs from it now (sinceSigned), and its open thread. Read without items to also get the stage's coverages and impacts. Pass items, as codes or ids, to read only those.",
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
    "The open threads these changes answer, each with a reply telling the spec owner what changed. get_workflow_state lists them.",
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
      "Write, change and remove items of any open stages, all or none, following each stage's published rules from get_stage_rules. Name items by the codes of the codesVersion you send. An added or changed item rests on the current versions of what it references and depends on; an item changed to exactly what it was stays as it was. Removing a signed item proposes its removal, which the spec owner signs; an item never signed is removed at once. A reference links to an item of a stage this stage builds on; a dependency links to an item of the same stage, or of another module as \"Module name/CODE\" in the same stage or one it builds on. Pass answers to reply to the threads these changes answer. Only the spec owner signs and resolves threads.",
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
                description: "For add and change: the item's fields by name, as get_stage_rules lists them, such as text and priority (p0, p1 or p2). A change replaces only the fields it names.",
              },
              references: { type: "array", items: { type: "string" }, description: "Codes of the items it references; a change replaces them all." },
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
    if (stringArgument(args, "codesVersion") !== store.codesVersion) {
      throw new UserFacingError(
        `The codes moved since codesVersion ${String(args.codesVersion)}; it is ${store.codesVersion} now. Read get_items again and name the items by the new codes.`,
      );
    }
    const answers = parseAnswers(args.answers);
    const answerProblem = store.answerProblem(answers);
    if (answerProblem != null) throw new UserFacingError(answerProblem);
    const changes = parseChanges(store, args.changes);
    const codesBefore = store.codesVersion;
    const outcome = store.writeItems(changes);
    if (answers.length > 0) store.answerThreads(answers, { kind: "agent", name: caller.name }, changes.length > 0);
    const lines = [
      ...outcomeLines(store, outcome),
      ...(answers.length > 0
        ? [`Replied to ${answers.length === 1 ? "one thread" : `${answers.length} threads`}; the spec owner reads the replies and resolves the threads.`]
        : []),
      "The spec owner signs these in Requireganizer; get_workflow_state shows what waits for a signature.",
    ];
    if (store.codesVersion !== codesBefore) lines.push(`Codes may have moved (codesVersion ${store.codesVersion}): read get_items again before naming items.`);
    return lines.join("\n");
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
  return [...READ_TOOLS, writeTool, replyTool, ...(open.addModule == null ? [] : [createModuleTool])];
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

/** Run one tool for an outside agent. Throws a message the agent can act on when the call fails. */
export async function callAgentTool(
  store: Store,
  name: string,
  args: Arguments,
  open: OpenModule = {},
  caller: AgentCaller = { name: "The coding agent" },
): Promise<string> {
  const tool = toolsFor(open).find(({ description }) => description.name === name);
  if (tool == null) throw new UserFacingError(`No tool named ${name} is available now.`);
  return tool.run(store, args, open, caller);
}
