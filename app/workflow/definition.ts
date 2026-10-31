import { chosenItems, type ItemContent } from "./records";

interface FieldBase {
  /** The key the field has in an item's content. */
  name: string;
  label: string;
  /** What the field holds, as a writer of the item is told. */
  description: string;
  /** Whether an item is refused without a value for it. */
  required: boolean;
}

/** Free text. */
export interface TextFieldDefinition extends FieldBase {
  type: "text";
  /** Words the form shows in front of the value, which the value does not repeat. */
  prefix?: string;
}

/** One of a fixed list of values, such as a priority. */
export interface ChoiceFieldDefinition extends FieldBase {
  type: "choice";
  options: readonly string[];
}

/**
 * A choice of items of one kind of a basis stage, by id. The item counts
 * as referencing each item chosen, so its references never list them again.
 */
export interface ItemsFieldDefinition extends FieldBase {
  type: "items";
  /** The kind of the items chosen. */
  of: string;
  /** The text field of a chosen item that names it where the item is shown. */
  shows: string;
}

/** A field of an item's content, as its kind declares it. */
export type FieldDefinition = TextFieldDefinition | ChoiceFieldDefinition | ItemsFieldDefinition;

/** An item's content as it is shown: each text field's text and, for each items field, the chosen items' names. */
export interface ShownParts {
  /** A text or choice field's value, or "" when it has none. */
  text(field: string): string;
  /** The names of the items an items field chooses. */
  names(field: string): string[];
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
  fields: readonly FieldDefinition[];
  /** Kinds of a basis stage of which an item must reference at least one item, through its references or an items field. */
  mustReference?: readonly string[];
  /** The item as one text, as every view of it shows it; choice fields show beside it. */
  display(parts: ShownParts): string;
}

/** A stage this stage builds on, and the kinds of its items this stage covers. */
export interface BasisDefinition {
  stage: string;
  covers: readonly string[];
}

export interface StageDefinition {
  id: string;
  label: string;
  buildsOn: readonly BasisDefinition[];
  kinds: readonly ItemKindDefinition[];
  /** The stage's published rules, which every writer and signer of the stage works to. */
  rules: string;
}

/** The stages of a module, each after the stages it builds on. */
export interface WorkflowDefinition {
  stages: readonly StageDefinition[];
}

/** The definition, checked once: a stage builds only on earlier stages and covers only their kinds. */
export function defineWorkflow(definition: WorkflowDefinition): WorkflowDefinition {
  const seenStages = new Map<string, StageDefinition>();
  const seenKinds = new Set<string>();
  const seenCodes = new Set<string>();
  for (const stage of definition.stages) {
    if (seenStages.has(stage.id)) throw new Error(`Stage ${stage.id} is defined twice.`);
    for (const basis of stage.buildsOn) {
      const basisStage = seenStages.get(basis.stage);
      if (basisStage == null) {
        throw new Error(`Stage ${stage.id} builds on ${basis.stage}, which is not defined before it.`);
      }
      for (const kind of basis.covers) {
        if (!basisStage.kinds.some((candidate) => candidate.kind === kind)) {
          throw new Error(`Stage ${stage.id} covers ${kind}, which ${basis.stage} does not hold.`);
        }
      }
    }
    const basisKinds = new Map(
      stage.buildsOn.flatMap((basis) => seenStages.get(basis.stage)!.kinds.map((kind) => [kind.kind, kind] as const)),
    );
    for (const kind of stage.kinds) {
      if (seenKinds.has(kind.kind)) throw new Error(`Item kind ${kind.kind} is defined twice.`);
      for (const field of kind.fields) {
        if (field.type !== "items") continue;
        const chosen = basisKinds.get(field.of);
        if (chosen == null) throw new Error(`${kind.kind}.${field.name} chooses ${field.of}, which no stage ${stage.id} builds on holds.`);
        if (!chosen.fields.some(({ name, type }) => name === field.shows && type === "text")) {
          throw new Error(`${kind.kind}.${field.name} shows ${field.shows}, which is not a text field of ${field.of}.`);
        }
      }
      for (const required of kind.mustReference ?? []) {
        if (!basisKinds.has(required)) throw new Error(`${kind.kind} must reference ${required}, which no stage ${stage.id} builds on holds.`);
      }
      if (seenCodes.has(kind.code)) throw new Error(`Item code ${kind.code} is defined twice.`);
      seenKinds.add(kind.kind);
      seenCodes.add(kind.code);
    }
    seenStages.set(stage.id, stage);
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

  isKind(name: unknown): name is string {
    return typeof name === "string" && this.kindsByName.has(name);
  }

  stageOfKind(name: string): string {
    const entry = this.kindsByName.get(name);
    if (entry == null) throw new Error(`No item kind ${name}.`);
    return entry.stage.id;
  }

  /** The stages a stage builds on directly. */
  basisStages(id: string): string[] {
    return this.stage(id).buildsOn.map(({ stage }) => stage);
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

  /** The stages that build on a stage directly and cover the kind, with the kind's coverage asked there. */
  coveringStages(kind: string): string[] {
    const stage = this.stageOfKind(kind);
    return this.definition.stages
      .filter(({ buildsOn }) => buildsOn.some((basis) => basis.stage === stage && basis.covers.includes(kind)))
      .map(({ id }) => id);
  }

  /** The kinds whose items an item of `kind` chooses through an items field rather than its references. */
  chosenKinds(kind: string): string[] {
    return this.kind(kind).fields.flatMap((field) => (field.type === "items" ? [field.of] : []));
  }

  /** Every item an item references: those its items fields choose, then its references, each once. */
  referencesOf(kind: string, version: { content: ItemContent; references: readonly string[] }): string[] {
    const chosen = this.kind(kind).fields.flatMap((field) => (field.type === "items" ? chosenItems(version.content[field.name]) : []));
    return [...new Set([...chosen, ...version.references])];
  }

  /** The kinds of a basis stage's items that a stage covers. */
  coveredKinds(stage: string, basis: string): readonly string[] {
    return this.stage(stage).buildsOn.find((candidate) => candidate.stage === basis)?.covers ?? [];
  }
}
