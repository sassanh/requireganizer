import { chosenItems, flagValue, type FieldDefinition, type ModuleReader, type RecordContent, textValue } from "workflow";

import { ENTITY_TYPE, WORD_SET } from "./identifiers";

/** The types an input, a result or a column takes, besides the boundary's entity types and sets of words. */
export const SIMPLE_TYPES = ["text", "whole number", "number with decimals", "yes or no", "duration"] as const;

export type SimpleType = (typeof SIMPLE_TYPES)[number];

/** The units a duration is written with: milliseconds, seconds or minutes. */
export const DURATION_UNITS = ["ms", "s", "min"] as const;

/** A value's type: one of the simple types, an entity type or a set of words of the boundary, or a list of one of them. */
export interface ValueType {
  base: { simple: SimpleType } | { entity: string } | { words: string };
  list: boolean;
  possiblyEmpty: boolean;
}

export const DURATION: ValueType = { base: { simple: "duration" }, list: false, possiblyEmpty: false };

/** The fields a type is written in. */
export const TYPE_FIELDS: readonly FieldDefinition[] = [
  {
    name: "simple",
    label: "Simple type",
    description: `One of ${SIMPLE_TYPES.join(", ")}; or leave it empty and choose an entity type or a set of words.`,
    type: "choice",
    options: SIMPLE_TYPES,
    required: false,
  },
  {
    name: "entity",
    label: "Entity type",
    description: "An entity type of the boundary, by code, instead of a simple type.",
    type: "items",
    of: ENTITY_TYPE,
    shows: "name",
    single: true,
    required: false,
  },
  {
    name: "words",
    label: "Set of words",
    description: "A set of words of the boundary, by code, instead of a simple type.",
    type: "items",
    of: WORD_SET,
    shows: "name",
    single: true,
    required: false,
  },
  { name: "list", label: "List", description: "A list of values of that type.", type: "flag", required: false },
  {
    name: "possiblyEmpty",
    label: "Possibly empty",
    description: 'Whether it may be empty: its empty value is chosen as empty, or written "" for a text and [] for a list. A value of the same type never empty also fits it.',
    type: "flag",
    required: false,
  },
];

/** A written type as a type, or why it is not one. */
export function parseType(record: RecordContent | null): { type: ValueType } | { problem: string } {
  if (record == null) return { problem: "has no type." };
  const simple = textValue(record.simple);
  const entity = chosenItems(record.entity)[0];
  const words = chosenItems(record.words)[0];
  const chosen = [simple !== "", entity != null, words != null].filter(Boolean).length;
  if (chosen !== 1) return { problem: "must have exactly one of a simple type, an entity type or a set of words." };
  const base = simple !== "" ? { simple: simple as SimpleType } : entity != null ? { entity } : { words: words! };
  return { type: { base, list: flagValue(record.list), possiblyEmpty: flagValue(record.possiblyEmpty) } };
}

/** A written type as a type, or null when it is none or not one. */
export function typeOf(record: RecordContent | null): ValueType | null {
  const parsed = parseType(record);
  return "type" in parsed ? parsed.type : null;
}

/** Whether a value of type `value` fits a place of type `place`: their base and list agree, and either the place may be empty or the value never is. */
export function fitsType(value: ValueType, place: ValueType): boolean {
  return JSON.stringify(value.base) === JSON.stringify(place.base) && value.list === place.list && (place.possiblyEmpty || !value.possiblyEmpty);
}

/** The type of one value of a list. */
export function elementType(type: ValueType): ValueType {
  return { base: type.base, list: false, possiblyEmpty: false };
}

/** Whether a value of the type is an entity or a list of entities. */
export function holdsEntities(type: ValueType): boolean {
  return "entity" in type.base;
}

function nameOf(id: string, module: ModuleReader): string {
  const item = module.item(id);
  return item == null ? "a removed item" : textValue(item.content.name) || item.code;
}

/** A type as the spec owner reads it, such as "possibly empty list of Order". */
export function describeType(type: ValueType, module: ModuleReader): string {
  const base = "simple" in type.base ? type.base.simple : nameOf("entity" in type.base ? type.base.entity : type.base.words, module);
  return `${type.possiblyEmpty ? "possibly empty " : ""}${type.list ? "list of " : ""}${base}`;
}

/** The types whose values fit a place of the type, as the spec owner reads them, such as "possibly empty whole number or whole number". */
export function describeFittingTypes(place: ValueType, module: ModuleReader): string {
  const described = describeType(place, module);
  return place.possiblyEmpty ? `${described} or ${describeType({ ...place, possiblyEmpty: false }, module)}` : described;
}

/** A written type as the spec owner reads it, or "none". */
export function describeWrittenType(record: RecordContent | null, module: ModuleReader): string {
  const type = typeOf(record);
  return type == null ? "none" : describeType(type, module);
}

/** The entries of a written list, such as [1, 2] or ["a, b", "c"], or null when it is not written as a list. */
function listEntries(written: string): string[] | null {
  const trimmed = written.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1);
  if (inner.trim() === "") return [];
  const entries: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < inner.length; index += 1) {
    const character = inner[index]!;
    if (quoted && character === "\\") {
      current += character + (inner[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (character === '"') quoted = !quoted;
    if (character === "," && !quoted) {
      entries.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  entries.push(current.trim());
  return entries;
}

/** Why a written literal is not a value of the type, or null when it is one. */
export function literalProblem(type: ValueType, written: string, module: ModuleReader): string | null {
  const described = describeType(type, module);
  if (type.list) {
    const entries = listEntries(written);
    if (entries == null) return `${written} is not a list; a ${described} is written as [first, second].`;
    if (entries.length === 0) return type.possiblyEmpty ? null : `[] is empty, but ${described} is not possibly empty.`;
    for (const entry of entries) {
      const problem = literalProblem(elementType(type), entry, module);
      if (problem != null) return problem;
    }
    return null;
  }
  if ("entity" in type.base) {
    return `an entity is never written as a value; take ${described} from the result of an earlier named step${type.possiblyEmpty ? ", or choose empty" : ""}.`;
  }
  // Where the type may be empty, a refused value also says how to give none.
  const withEmptyHint = (problem: string | null) =>
    problem == null || !type.possiblyEmpty ? problem : `${problem.replace(/\.$/, "")}; to give no value, choose empty.`;
  if ("words" in type.base) {
    const words = module.item(type.base.words)?.content.words;
    const known = Array.isArray(words) ? (words as readonly string[]) : [];
    return withEmptyHint(known.includes(written) ? null : `${written} is not a word of ${described}; it is one of ${known.join(", ")}.`);
  }
  return withEmptyHint(simpleLiteralProblem(type.base.simple, type.possiblyEmpty, written, described));
}

/** Why a written literal is not a value of a simple type, or null when it is one. */
function simpleLiteralProblem(simple: SimpleType, possiblyEmpty: boolean, written: string, described: string): string | null {
  switch (simple) {
    case "text": {
      if (!/^".*"$/s.test(written)) return `${written} is not a text; write a text in double quotes, such as "red shoes".`;
      let text: string;
      try {
        text = JSON.parse(written) as string;
      } catch {
        return `${written} is not a text; write a text in double quotes, with \\" for a quote inside it.`;
      }
      return text === "" && !possiblyEmpty ? `"" is empty, but ${described} is not possibly empty.` : null;
    }
    case "whole number":
      return /^-?\d+$/.test(written) ? null : `${written} is not a whole number.`;
    case "number with decimals":
      return /^-?\d+(\.\d+)?$/.test(written) ? null : `${written} is not a number, such as 2.5.`;
    case "yes or no":
      return written === "yes" || written === "no" ? null : `${written} is neither yes nor no.`;
    case "duration":
      return new RegExp(`^\\d+(\\.\\d+)? ?(${DURATION_UNITS.join("|")})$`).test(written)
        ? null
        : `${written} is not a duration; write a number and a unit of ${DURATION_UNITS.join(", ")}, such as 200 ms.`;
  }
}

/** Why the empty value, chosen, is not a value of the type, or null when it is one. */
export function emptyProblem(type: ValueType, module: ModuleReader): string | null {
  return type.possiblyEmpty ? null : `empty is chosen, but ${describeType(type, module)} is not possibly empty.`;
}

/** The comparisons a Then step offers, by their stored names. */
export const COMPARISONS = ["equals", "differs from", "has the same values as", "at most", "at least", "contains", "does not contain"] as const;

export type Comparison = (typeof COMPARISONS)[number];

/** A comparison as it reads in a Then sentence. */
export function comparisonWords(comparison: string): string {
  return comparison === "at most" || comparison === "at least" ? `is ${comparison}` : comparison;
}

/** The comparisons the type of what a Then step compares allows. */
export function comparisonsFor(type: ValueType): Comparison[] {
  const ordered = !type.list && "simple" in type.base && ["whole number", "number with decimals", "duration"].includes(type.base.simple);
  return [
    "equals",
    "differs from",
    ...(type.list ? (["has the same values as", "contains", "does not contain"] as const) : []),
    ...(ordered ? (["at most", "at least"] as const) : []),
  ];
}

/** The type of the expected value a comparison takes for what it compares: one entry for contains and does not contain, the same type otherwise. */
export function expectedTypeOf(comparison: string, compared: ValueType): ValueType {
  return comparison === "contains" || comparison === "does not contain" ? elementType(compared) : compared;
}
