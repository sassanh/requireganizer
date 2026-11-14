import { formatCode } from "lib/fragmentCodes";

import { chosenItems, type FieldValue, type ItemContent, type RecordContent, recordsValue, recordValue, textValue } from "./records";

/** One item of the module, as a rule of a kind reads it. */
export interface ReadItem {
  id: string;
  kind: string;
  code: string;
  content: ItemContent;
  /** Every item it references, those its items fields choose included. */
  references: readonly string[];
  /** Its text as every view of it shows it. */
  text: string;
}

/** The module's items, as a kind's rules read them. */
export interface ModuleReader {
  /** Any item the module holds, whatever its phase. */
  item(id: string): ReadItem | null;
  /** The items of a kind that are neither proposed for removal nor removed. */
  itemsOf(kind: string): ReadItem[];
}

/** Where a field sits in an item being written, for a rule that narrows the values it offers. */
export interface FieldPlace {
  /** The whole item's content. */
  content: ItemContent;
  /** The records enclosing the field, outermost first: the records field holding each, its entry's name, its index there, and the record. */
  path: readonly { field: string; entry: string; index: number; record: RecordContent }[];
  /** The record holding the field: the item's content at the top. */
  record: RecordContent;
  module: ModuleReader;
}

/** The values a field offers at one place, and the rule that decides them, as a refusal states it. */
export interface Offer {
  values: readonly string[];
  rule: string;
}

interface FieldBase {
  /** The key the field has in an item's content. */
  name: string;
  label: string;
  /** What the field holds, as a writer of the item is told. */
  description: string;
  /** Whether an item is refused without a value for it: for a list, without at least one entry. */
  required: boolean;
}

/** Free text. */
export interface TextFieldDefinition extends FieldBase {
  type: "text";
  /**
   * Words shown in front of the value, which the value does not repeat. The
   * first of a kind's fields with a prefix also puts it in front of the
   * item's display.
   */
  prefix?: string;
  /** The only texts it may hold where it sits, when they depend on the rest of the item. */
  offered?: (place: FieldPlace) => Offer;
}

/** One of a fixed list of values, such as a priority. */
export interface ChoiceFieldDefinition extends FieldBase {
  type: "choice";
  options: readonly string[];
  /** The option a new item starts with, if any. */
  initial?: string;
  /** Whether each option is shown with a visual cue of its own, telling the options apart at a glance. */
  cued?: boolean;
  /** The options it offers where it sits, when they depend on the rest of the item. */
  offered?: (place: FieldPlace) => Offer;
}

/** Yes or no, stored as true or false; it is never missing. */
export interface FlagFieldDefinition extends FieldBase {
  type: "flag";
  required: false;
}

/** A list of short texts, none empty, such as words. */
export interface TextsFieldDefinition extends FieldBase {
  type: "texts";
}

/**
 * A choice of items of one kind, by id: of a basis stage, which the item
 * counts as referencing, or of its own stage, which it counts as depending
 * on, so its links never list them again.
 */
export interface ItemsFieldDefinition extends FieldBase {
  type: "items";
  /** The kind of the items chosen. */
  of: string;
  /** The text field of a chosen item that names it where the item is shown. */
  shows: string;
  /** Whether it chooses at most one item. */
  single?: boolean;
  /** The items it offers where it sits, by id, when they depend on the rest of the item. */
  offered?: (place: FieldPlace) => Offer;
}

/** One record with fields of its own, or none. */
export interface RecordFieldDefinition extends FieldBase {
  type: "record";
  fields: readonly FieldDefinition[];
}

/** A list of records, each with the same fields of its own. */
export interface RecordsFieldDefinition extends FieldBase {
  type: "records";
  /** The singular name of one record, such as "input". */
  entry: string;
  fields: readonly FieldDefinition[];
}

/** A field of an item's content, as its kind declares it. */
export type FieldDefinition =
  | TextFieldDefinition
  | ChoiceFieldDefinition
  | FlagFieldDefinition
  | TextsFieldDefinition
  | ItemsFieldDefinition
  | RecordFieldDefinition
  | RecordsFieldDefinition;

/** A field as it sits in an item's content: its definition, its value, and the records enclosing it. */
export interface PlacedField {
  field: FieldDefinition;
  value: FieldValue;
  path: FieldPlace["path"];
  record: RecordContent;
}

/** Every field of a content at any depth, records' fields after the field holding them. */
export function placedFields(fields: readonly FieldDefinition[], content: RecordContent, path: FieldPlace["path"] = []): PlacedField[] {
  return fields.flatMap((field): PlacedField[] => {
    const value = content[field.name] ?? null;
    const placed: PlacedField = { field, value, path, record: content };
    switch (field.type) {
      case "record": {
        const record = recordValue(value);
        return [placed, ...(record == null ? [] : placedFields(field.fields, record, path))];
      }
      case "records":
        return [
          placed,
          ...recordsValue(value).flatMap((record, index) => placedFields(field.fields, record, [...path, { field: field.name, entry: field.entry, index, record }])),
        ];
      default:
        return [placed];
    }
  });
}

/** Every items field of a list of fields, at any depth. */
export function itemsFields(fields: readonly FieldDefinition[]): ItemsFieldDefinition[] {
  return fields.flatMap((field) => {
    if (field.type === "items") return [field];
    if (field.type === "record" || field.type === "records") return itemsFields(field.fields);
    return [];
  });
}

/** The content with each items field's value, at any depth, replaced: such as its ids by codes for a reader, or back. */
export function mapItemsFields(fields: readonly FieldDefinition[], content: RecordContent, map: (value: FieldValue, field: ItemsFieldDefinition) => FieldValue): RecordContent {
  const known = new Map(fields.map((field) => [field.name, field] as const));
  return Object.fromEntries(
    Object.entries(content).map(([name, value]) => {
      const field = known.get(name);
      switch (field?.type) {
        case "items":
          return [name, map(value, field)];
        case "record": {
          const record = recordValue(value);
          return [name, record == null ? value : mapItemsFields(field.fields, record, map)];
        }
        case "records":
          return [name, Array.isArray(value) && recordsValue(value).length === value.length ? recordsValue(value).map((record) => mapItemsFields(field.fields, record, map)) : value];
        default:
          return [name, value];
      }
    }),
  );
}

/** An item's content as it is shown: each field's value, and the module it reads other items from. */
export interface ShownParts {
  /** A text or choice field's value, or "" when it has none. */
  text(field: string): string;
  /** The names of the items an items field chooses. */
  names(field: string): string[];
  content: ItemContent;
  module: ModuleReader;
}

/**
 * Kinds of a basis stage of which an item must reference at least one item,
 * of any of them; with `when`, only an item whose choice field holds that
 * option, such as a requirement whose type is constraint.
 */
export interface ReferenceRule {
  kinds: readonly string[];
  when?: { field: string; is: string };
}

/** Whether a reference rule applies to an item with this content. */
export function referenceRuleApplies(rule: ReferenceRule, content: ItemContent): boolean {
  return rule.when == null || textValue(content[rule.when.field]) === rule.when.is;
}

/** The items a reference rule applies to, as words after "whose", such as "type is constraint"; null for every item. */
export function referenceRuleCondition(rule: ReferenceRule, fields: readonly FieldDefinition[]): string | null {
  if (rule.when == null) return null;
  const { field, is } = rule.when;
  return `${(fields.find(({ name }) => name === field)?.label ?? field).toLowerCase()} is ${is}`;
}

/** One kind of item a stage holds, such as user stories. */
export interface ItemKindDefinition {
  kind: string;
  /** The singular name, such as "User story". */
  label: string;
  /** The plural name, such as "User stories". */
  plural: string;
  /**
   * The prefix of its items' codes, such as "US". A kind with `single`
   * holds at most one item, whose code is the prefix alone.
   */
  code: string;
  single?: boolean;
  /** The question its items answer, as its definition states it: the first of its published rules. */
  question: string;
  /** Its own published rules, each a sentence, after its question; every kind also publishes the shared rules. */
  rules: readonly string[];
  fields: readonly FieldDefinition[];
  /** Kinds of a basis stage whose items' coverage its items give: the coverage of each such item is asked in its stage. */
  covers?: readonly string[];
  /** What an item must reference, through its references or an items field: each entry that applies to it, at least one item of any of its kinds. */
  mustReference?: readonly ReferenceRule[];
  /** Kinds of a basis stage whose items an item never references. */
  mayNotReference?: readonly string[];
  /** Single kinds of a basis stage whose item every item of this kind counts as referencing, without listing it. */
  referencesSingle?: readonly string[];
  /** Single kinds of its own stage whose item every item of this kind counts as depending on, without listing it. */
  dependsOnSingle?: readonly string[];
  /**
   * The item's problems that span fields or items, beyond each field's
   * own, each a sentence the writer can act on. Every save checks them.
   */
  check?(content: ItemContent, module: ModuleReader, itemId: string): string[];
  /** The item as one text, after its kind's prefix if it has one, as every view of it shows it; choice fields show beside it. */
  display(parts: ShownParts): string;
  /** Short marks shown beside the item, such as that a test starts from a direct setup. */
  marks?(parts: ShownParts): string[];
  /** The fields of one item of this kind, as a writer sends them, to show the shape. */
  example?: Readonly<Record<string, unknown>>;
}

export interface StageDefinition {
  id: string;
  label: string;
  /** The stages it builds on directly. Which kinds of their items it covers, its kinds say. */
  buildsOn: readonly string[];
  kinds: readonly ItemKindDefinition[];
}

/** One item of a kind as its published rules show it: its text as shown, and what it holds that its text does not show. */
export interface KindExample {
  text: string;
  /** Such as its references, or a requirement's type. */
  details?: string;
}

/** An item of another kind, or a wrong item of the same kind, that could pass for an item of a kind. */
export interface KindTrap {
  /** The kind the item is of. */
  kind: string;
  text: string;
  /** One sentence: which question it answers, and why that is not the question of the kind it could pass for. */
  why: string;
}

/** The examples published with a kind's rules. */
export interface KindExamples {
  /** One item of the kind. */
  good: KindExample;
  /**
   * For each other kind held by its stage, by a stage its stage builds on
   * or by a stage building on its stage, one item of that kind that could
   * pass for an item of this kind; and any item of this kind written as
   * something it is not.
   */
  traps: readonly KindTrap[];
}

/** A kind's published rules, the same for every writer and every signer: its question first, then its own rules, the shared rules and its examples. */
export interface PublishedRules {
  question: string;
  rules: readonly string[];
  shared: readonly string[];
  examples: KindExamples;
}

/** The published rules every kind of item holds after its own. */
const SHARED_RULES: readonly string[] = [
  "An item states only what answers its kind's question.",
  "Two items of the same kind never give the same answer to its question, wholly or in part.",
  "An item serves each item it references: if the item were removed, each item it references would be less delivered.",
  "An item names no way of building the product, unless its kind's question asks for limits set from outside the product, or an item it references, directly or through other items, names that way.",
  "A reference links an item to an item of a stage its own stage builds on; a dependency links it to an item of its own stage or of another module that it relies on.",
  "An item is signed as it is shown. Write each item so that it can be judged on its own.",
];

/** The stages of a module, each after the stages it builds on, and the examples published with each kind's rules. */
export interface WorkflowDefinition {
  stages: readonly StageDefinition[];
  /** By kind. */
  examples: Readonly<Record<string, KindExamples>>;
}

/** The kinds held by a stage, by the stages it builds on directly and by the stages building on it directly. */
function neighbourKinds(stages: readonly StageDefinition[], stage: StageDefinition): Set<string> {
  const neighbours = stages.filter(
    (candidate) => candidate.id === stage.id || stage.buildsOn.includes(candidate.id) || candidate.buildsOn.includes(stage.id),
  );
  return new Set(neighbours.flatMap((candidate) => candidate.kinds.map(({ kind }) => kind)));
}

/**
 * The definition, checked once: a stage builds only on earlier stages; its
 * kinds cover, require and refuse only kinds of those stages, each covered
 * kind by one kind; and each kind's examples hold one trap of each other
 * kind next to it.
 */
export function defineWorkflow(definition: WorkflowDefinition): WorkflowDefinition {
  const seenStages = new Map<string, StageDefinition>();
  const seenKinds = new Set<string>();
  const seenCodes = new Set<string>();
  for (const stage of definition.stages) {
    if (seenStages.has(stage.id)) throw new Error(`Stage ${stage.id} is defined twice.`);
    for (const basis of stage.buildsOn) {
      if (!seenStages.has(basis)) throw new Error(`Stage ${stage.id} builds on ${basis}, which is not defined before it.`);
    }
    const basisKinds = new Map(
      stage.buildsOn.flatMap((basis) => seenStages.get(basis)!.kinds.map((kind) => [kind.kind, kind] as const)),
    );
    const ownKinds = new Map(stage.kinds.map((kind) => [kind.kind, kind] as const));
    const coveredBy = new Map<string, string>();
    for (const kind of stage.kinds) {
      if (seenKinds.has(kind.kind)) throw new Error(`Item kind ${kind.kind} is defined twice.`);
      for (const field of itemsFields(kind.fields)) {
        const chosen = basisKinds.get(field.of) ?? ownKinds.get(field.of);
        if (chosen == null) throw new Error(`${kind.kind}.${field.name} chooses ${field.of}, which neither stage ${stage.id} nor a stage it builds on holds.`);
        if (!chosen.fields.some(({ name, type }) => name === field.shows && type === "text")) {
          throw new Error(`${kind.kind}.${field.name} shows ${field.shows}, which is not a text field of ${field.of}.`);
        }
      }
      for (const covered of kind.covers ?? []) {
        if (!basisKinds.has(covered)) throw new Error(`${kind.kind} covers ${covered}, which no stage ${stage.id} builds on holds.`);
        const other = coveredBy.get(covered);
        if (other != null) throw new Error(`${kind.kind} and ${other} both cover ${covered}.`);
        coveredBy.set(covered, kind.kind);
      }
      for (const rule of kind.mustReference ?? []) {
        if (rule.kinds.length === 0) throw new Error(`${kind.kind} has a rule of what it must reference that names no kind.`);
        if (rule.when == null) continue;
        const { field, is } = rule.when;
        const condition = kind.fields.find(({ name }) => name === field);
        if (condition?.type !== "choice" || !condition.options.includes(is)) {
          throw new Error(`${kind.kind} must reference ${rule.kinds.join(", ")} when ${field} is ${is}, which is not an option of a choice field of it.`);
        }
      }
      for (const linked of [...(kind.mustReference ?? []).flatMap(({ kinds }) => kinds), ...(kind.mayNotReference ?? [])]) {
        if (!basisKinds.has(linked)) throw new Error(`${kind.kind} names ${linked} among what it references, which no stage ${stage.id} builds on holds.`);
      }
      for (const single of kind.referencesSingle ?? []) {
        if (basisKinds.get(single)?.single !== true) throw new Error(`${kind.kind} references ${single}, which is not a single kind of a stage ${stage.id} builds on.`);
      }
      for (const single of kind.dependsOnSingle ?? []) {
        if (ownKinds.get(single)?.single !== true) throw new Error(`${kind.kind} depends on ${single}, which is not a single kind of stage ${stage.id}.`);
      }
      if (seenCodes.has(kind.code)) throw new Error(`Item code ${kind.code} is defined twice.`);
      seenKinds.add(kind.kind);
      seenCodes.add(kind.code);
    }
    seenStages.set(stage.id, stage);
  }
  for (const stage of definition.stages) {
    const neighbours = neighbourKinds(definition.stages, stage);
    for (const { kind } of stage.kinds) {
      const examples = definition.examples[kind];
      if (examples == null) throw new Error(`${kind} has no examples.`);
      const trapped = examples.traps.map((trap) => trap.kind).filter((trapKind) => trapKind !== kind);
      const expected = [...neighbours].filter((neighbour) => neighbour !== kind);
      if (trapped.length !== new Set(trapped).size || trapped.length !== expected.length || !expected.every((neighbour) => trapped.includes(neighbour))) {
        throw new Error(`${kind}'s examples hold traps of ${trapped.join(", ") || "no kind"}; they hold one of each of ${expected.join(", ") || "no kind"}.`);
      }
    }
  }
  for (const kind of Object.keys(definition.examples)) {
    if (!seenKinds.has(kind)) throw new Error(`Examples are given for ${kind}, which no stage holds.`);
  }
  return definition;
}

/** Questions about a workflow definition that every part of the engine asks the same way. */
export class Workflow {
  readonly definition: WorkflowDefinition;
  private readonly stagesById: Map<string, StageDefinition>;
  private readonly kindsByName: Map<string, { kind: ItemKindDefinition; stage: StageDefinition }>;
  private readonly upstreamCache = new Map<string, readonly string[]>();

  constructor(definition: WorkflowDefinition) {
    this.definition = defineWorkflow(definition);
    this.stagesById = new Map(definition.stages.map((stage) => [stage.id, stage]));
    this.kindsByName = new Map(
      definition.stages.flatMap((stage) => stage.kinds.map((kind) => [kind.kind, { kind, stage }] as const)),
    );
  }

  get stageIds(): string[] {
    return this.definition.stages.map(({ id }) => id);
  }

  get firstStage(): string {
    return this.definition.stages[0]!.id;
  }

  /** The published rules every kind holds after its own. */
  get sharedRules(): readonly string[] {
    return SHARED_RULES;
  }

  /** A kind's published rules: its question, its own rules, the rules every kind shares, and its examples. */
  publishedRules(kind: string): PublishedRules {
    const definition = this.kind(kind);
    return { question: definition.question, rules: definition.rules, shared: SHARED_RULES, examples: this.definition.examples[kind]! };
  }

  isStage(id: unknown): id is string {
    return typeof id === "string" && this.stagesById.has(id);
  }

  stage(id: string): StageDefinition {
    const stage = this.stagesById.get(id);
    if (stage == null) throw new Error(`No stage ${id}.`);
    return stage;
  }

  kind(name: string): ItemKindDefinition {
    const entry = this.kindsByName.get(name);
    if (entry == null) throw new Error(`No item kind ${name}.`);
    return entry.kind;
  }

  /**
   * The code of one of a stage's items: its kind's code alone for a kind of
   * a single item, otherwise numbered among the stage's items of its kind.
   */
  codeOf(item: { kind: string }, stageItems: readonly { kind: string }[]): string {
    const definition = this.kind(item.kind);
    if (definition.single) return definition.code;
    const sameKind = stageItems.filter(({ kind }) => kind === item.kind);
    return formatCode(definition.code, sameKind.indexOf(item) + 1, sameKind.length);
  }

  /** The words shown in front of a kind's display: the prefix of the first of its fields that has one. */
  prefixOf(name: string): string | null {
    for (const field of this.kind(name).fields) {
      if (field.type === "text" && field.prefix != null) return field.prefix;
    }
    return null;
  }

  isKind(name: unknown): name is string {
    return typeof name === "string" && this.kindsByName.has(name);
  }

  stageOfKind(name: string): string {
    const entry = this.kindsByName.get(name);
    if (entry == null) throw new Error(`No item kind ${name}.`);
    return entry.stage.id;
  }

  /** The stages a stage builds on directly. */
  basisStages(id: string): readonly string[] {
    return this.stage(id).buildsOn;
  }

  /** The stages a stage builds on, directly or through other stages. */
  upstreamStages(id: string): readonly string[] {
    const cached = this.upstreamCache.get(id);
    if (cached != null) return cached;
    const found = new Set<string>();
    const visit = (stage: string) => {
      for (const basis of this.basisStages(stage)) {
        if (found.has(basis)) continue;
        found.add(basis);
        visit(basis);
      }
    };
    visit(id);
    const ordered = this.stageIds.filter((stage) => found.has(stage));
    this.upstreamCache.set(id, ordered);
    return ordered;
  }

  /** Whether `later` builds on `earlier`, directly or through other stages. */
  buildsOn(later: string, earlier: string): boolean {
    return this.upstreamStages(later).includes(earlier);
  }

  /** The stages that build on a stage directly. */
  stagesBuildingOn(id: string): string[] {
    return this.definition.stages.filter(({ buildsOn }) => buildsOn.includes(id)).map((stage) => stage.id);
  }

  /** The kind of a stage whose items give the coverage of items of `covered`, if the stage asks for that coverage. */
  coveringKind(stage: string, covered: string): string | null {
    return this.stage(stage).kinds.find((kind) => kind.covers?.includes(covered) === true)?.kind ?? null;
  }

  /** The stages that build on the kind's stage directly and cover the kind, with the kind's coverage asked there. */
  coveringStages(kind: string): string[] {
    return this.stagesBuildingOn(this.stageOfKind(kind)).filter((stage) => this.coveringKind(stage, kind) != null);
  }

  /** The kinds whose items an item of `kind` chooses through an items field, at any depth, rather than its links. */
  chosenKinds(kind: string): string[] {
    return [...new Set(itemsFields(this.kind(kind).fields).map((field) => field.of))];
  }

  /** The items an item's items fields choose, at any depth, of the kinds `stage` holds. */
  private chosenIn(kind: string, content: ItemContent, stages: readonly string[]): string[] {
    return placedFields(this.kind(kind).fields, content).flatMap(({ field, value }) =>
      field.type === "items" && stages.includes(this.stageOfKind(field.of)) ? chosenItems(value) : [],
    );
  }

  /** The items of a basis stage an item's items fields choose, which it counts as referencing. */
  chosenReferences(kind: string, content: ItemContent): string[] {
    return [...new Set(this.chosenIn(kind, content, this.basisStages(this.stageOfKind(kind))))];
  }

  /** The items of its own stage an item's items fields choose, which it counts as depending on. */
  chosenDependencies(kind: string, content: ItemContent): string[] {
    return [...new Set(this.chosenIn(kind, content, [this.stageOfKind(kind)]))];
  }

  /** The kinds of a basis stage's items that a stage covers, as its kinds cover them. */
  coveredKinds(stage: string, basis: string): string[] {
    const held = new Set(this.stage(basis).kinds.map(({ kind }) => kind));
    return this.stage(stage).kinds.flatMap((kind) => (kind.covers ?? []).filter((covered) => held.has(covered)));
  }
}
