/** A field of an item's content, as its kind declares it. */
export interface FieldDefinition {
  /** The key the field has in an item's content. */
  name: string;
  label: string;
  /** Free text, or one of the three priorities. */
  type: "text" | "priority";
  required: boolean;
}

export const PRIORITIES = ["p0", "p1", "p2"] as const;
export type Priority = (typeof PRIORITIES)[number];

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
    for (const kind of stage.kinds) {
      if (seenKinds.has(kind.kind)) throw new Error(`Item kind ${kind.kind} is defined twice.`);
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

  /** The kinds of a basis stage's items that a stage covers. */
  coveredKinds(stage: string, basis: string): readonly string[] {
    return this.stage(stage).buildsOn.find((candidate) => candidate.stage === basis)?.covers ?? [];
  }
}
