import {
  chosenItems,
  type FieldDefinition,
  flagValue,
  type FieldPlace,
  type ItemContent,
  type ModuleReader,
  type Offer,
  type RecordContent,
  recordsValue,
  recordValue,
  type ShownParts,
  textValue,
} from "workflow";

import { fillPhrase, type Operation, operationOf } from "./boundary";
import { ACTION, DIRECT_SETUP, GIVEN, OBSERVATION, OPERATION, OPERATION_KINDS, THEN, WHEN } from "./identifiers";
import {
  COMPARISONS,
  comparisonsFor,
  comparisonWords,
  describeFittingTypes,
  describeType,
  DURATION,
  DURATION_UNITS,
  emptyProblem,
  expectedTypeOf,
  fitsType,
  holdsEntities,
  literalProblem,
  parseType,
  typeOf,
  type ValueType,
} from "./valueTypes";

type StepSection = typeof GIVEN | typeof WHEN;

/** A Given or When step, with the operation it calls. */
interface Step {
  section: StepSection;
  index: number;
  record: RecordContent;
  name: string;
  operation: Operation | null;
}

const SECTION_LABELS: Record<string, string> = { [GIVEN]: "Given", [WHEN]: "When", [THEN]: "Then" };

/** The kinds of operation a step of each section calls. */
const SECTION_OPERATION_KINDS: Record<string, readonly string[]> = {
  [GIVEN]: OPERATION_KINDS,
  [WHEN]: [ACTION],
  [THEN]: [OBSERVATION],
};

function stepLabel(section: string, index: number): string {
  return `${SECTION_LABELS[section]} step ${index + 1}`;
}

function stepsOf(content: ItemContent, module: ModuleReader): Step[] {
  return ([GIVEN, WHEN] as const).flatMap((section) =>
    recordsValue(content[section]).map((record, index) => ({
      section,
      index,
      record,
      name: textValue(record.name),
      operation: operationOf(module, chosenItems(record.operation)[0]),
    })),
  );
}

/** The named Given and When steps before a step: every one for a Then step. */
function earlierNamedSteps(content: ItemContent, module: ModuleReader, section: string, index: number): Step[] {
  return stepsOf(content, module).filter((step) => {
    if (step.name === "") return false;
    if (section === THEN) return true;
    if (step.section === section) return step.index < index;
    return step.section === GIVEN && section === WHEN;
  });
}

function columnsOf(content: ItemContent): { name: string; type: ValueType | null }[] {
  return recordsValue(content.columns).map((column) => ({ name: textValue(column.name), type: typeOf(recordValue(column.type)) }));
}

/** The type of what a Then step compares, or null where it compares nothing or its type is not known yet. */
function comparedType(then: RecordContent, content: ItemContent, module: ModuleReader): ValueType | null {
  switch (textValue(then.expects)) {
    case "observation":
      return operationOf(module, chosenItems(then.operation)[0])?.result ?? null;
    case "result":
      return stepsOf(content, module).find((step) => step.name !== "" && step.name === textValue(then.step))?.operation?.result ?? null;
    case "duration":
      return DURATION;
    default:
      return null;
  }
}

/** The type a value takes: an input's, of its step's operation, or a Then step's expected value's. */
function valueType(place: FieldPlace, role: ValueRole): ValueType | null {
  const step = place.path[0]?.record;
  if (step == null) return null;
  if (role === "input") {
    const operation = operationOf(place.module, chosenItems(step.operation)[0]);
    return operation?.inputs.find((input) => input.name === textValue(place.record.input))?.type ?? null;
  }
  const compared = comparedType(step, place.content, place.module);
  return compared == null ? null : expectedTypeOf(textValue(step.comparison), compared);
}

type ValueRole = "input" | "expected";

function offerColumns(place: FieldPlace, role: ValueRole): Offer {
  const type = valueType(place, role);
  const columns = columnsOf(place.content).filter((column) => type == null || (column.type != null && fitsType(column.type, type)));
  return {
    values: columns.map(({ name }) => name),
    rule: type == null
      ? "a value takes a column of the test's table."
      : `a value of type ${describeType(type, place.module)} takes a column of the test's table of type ${describeFittingTypes(type, place.module)}${columns.length === 0 ? "; the table has none" : `: ${columns.map(({ name }) => name).join(", ")}`}.`,
  };
}

function offerSteps(place: FieldPlace, role: ValueRole): Offer {
  const step = place.path[0]!;
  const type = valueType(place, role);
  if (role === "expected" && type != null && !holdsEntities(type)) {
    return { values: [], rule: "an expected value takes the result of a named step only when it compares an entity or a list of entities." };
  }
  const steps = earlierNamedSteps(place.content, place.module, step.field, step.index).filter(
    (candidate) => candidate.operation?.result != null && (type == null || fitsType(candidate.operation.result, type)),
  );
  return {
    values: steps.map(({ name }) => name),
    rule: `a value takes the result of an earlier named step of the same test${type == null ? "" : ` whose result is ${describeFittingTypes(type, place.module)}`}${steps.length === 0 ? "; there is none" : `: ${steps.map(({ name }) => name).join(", ")}`}.`,
  };
}

const LITERAL_FIELD: FieldDefinition = {
  name: "literal",
  label: "Value",
  description: `The value written out: a text in double quotes such as "Dune", a whole number such as 3, a number with decimals written with a point such as 2.5, yes or no, a duration as a number followed by ${DURATION_UNITS.join(", ")} such as 200 ms, a word of its set as written, or a list as its values in square brackets, separated by commas, such as [1, 2]; "" is the empty text and [] the empty list. An entity is never written out.`,
  type: "text",
  required: false,
};

const EMPTY_FIELD: FieldDefinition = {
  name: "empty",
  label: "Empty",
  description: "Or the empty value, chosen, only where its type is possibly empty.",
  type: "flag",
  required: false,
};

/** The fields of a value: written out, chosen empty, a column of the table, or an earlier named step's result. */
function valueFields(role: ValueRole): FieldDefinition[] {
  return [
    LITERAL_FIELD,
    EMPTY_FIELD,
    {
      name: "column",
      label: "Column",
      description: "Or the name of a column of the test's table of the same type, or of that type never empty where this one is possibly empty.",
      type: "text",
      required: false,
      offered: (place) => offerColumns(place, role),
    },
    {
      name: "step",
      label: "Result of step",
      description:
        role === "input"
          ? "Or the name of an earlier Given or When step of the test whose result has the same type, or that type never empty where this one is possibly empty."
          : "Or the name of a Given or When step whose result has the same type, or that type never empty where this one is possibly empty, only when the step compares an entity or a list of entities.",
      type: "text",
      required: false,
      offered: (place) => offerSteps(place, role),
    },
  ];
}

/** The fields of a table row's cell: its column's value written out, or chosen empty. */
const CELL_FIELDS: readonly FieldDefinition[] = [LITERAL_FIELD, EMPTY_FIELD];

export const ROW_FIELDS: readonly FieldDefinition[] = [
  { name: "cells", label: "Cells", entry: "cell", description: "One cell per column, in the columns' order.", type: "records", fields: CELL_FIELDS, required: true },
];

const INPUT_FIELDS: FieldDefinition[] = [
  {
    name: "input",
    label: "Input",
    description: "The name of the operation's input this value goes to.",
    type: "text",
    required: true,
    offered: (place) => {
      const operation = operationOf(place.module, chosenItems(place.path[0]?.record.operation)[0]);
      return operation == null
        ? { values: [], rule: "choose the step's operation first." }
        : { values: operation.inputs.map(({ name }) => name), rule: `${operation.code}'s inputs are ${operation.inputs.map(({ name }) => name).join(", ") || "none"}.` };
    },
  },
  ...valueFields("input"),
];

function offerOperations(place: FieldPlace): Offer {
  const section = place.path[0]?.field ?? GIVEN;
  const kinds = SECTION_OPERATION_KINDS[section] ?? [];
  const criterion = chosenItems(place.content.criterion)[0];
  const operations = place.module
    .itemsOf(OPERATION)
    .filter((operation) => kinds.includes(textValue(operation.content.kind)) && criterion != null && operation.references.includes(criterion));
  return {
    values: operations.map(({ id }) => id),
    rule: `a ${SECTION_LABELS[section]} step calls ${kinds.map((kind) => `${kind}s`).join(", ")} of the boundary that reference the test's acceptance criterion${operations.length === 0 ? "; there is none" : `: ${operations.map(({ code }) => code).join(", ")}`}.`,
  };
}

const OPERATION_FIELD: FieldDefinition = {
  name: "operation",
  label: "Operation",
  description: "The operation the step calls, by code.",
  type: "items",
  of: OPERATION,
  shows: "name",
  single: true,
  required: true,
  offered: offerOperations,
};

export const STEP_FIELDS: readonly FieldDefinition[] = [
  { name: "name", label: "Name", description: "A name by which later steps use its result; optional.", type: "text", required: false },
  OPERATION_FIELD,
  {
    name: "inputs",
    label: "Inputs",
    entry: "input",
    description: "One value for each input of the operation.",
    type: "records",
    fields: INPUT_FIELDS,
    required: false,
  },
];

export const THEN_FIELDS: readonly FieldDefinition[] = [
  {
    name: "expects",
    label: "Expects",
    description:
      "observation: an observation's result compared with an expected value; result: a named step's result compared with an expected value; duration: how long a named When step took compared with a duration; refusal: a named When step refused with a refusal its action declares.",
    type: "choice",
    options: ["observation", "result", "duration", "refusal"],
    required: true,
  },
  { ...OPERATION_FIELD, description: "For observation: the observation it calls, by code.", required: false },
  {
    name: "inputs",
    label: "Inputs",
    entry: "input",
    description: "For observation: one value for each input of the observation.",
    type: "records",
    fields: INPUT_FIELDS,
    required: false,
  },
  {
    name: "step",
    label: "Step",
    description: "For result, duration and refusal: the name of the step it is about.",
    type: "text",
    required: false,
    offered: (place) => {
      const expects = textValue(place.record.expects);
      const steps = earlierNamedSteps(place.content, place.module, THEN, 0).filter((step) => expects === "result" || step.section === WHEN);
      return {
        values: steps.map(({ name }) => name),
        rule: `${expects === "result" ? "a result is a named Given or When step's" : `a ${expects} is about a named When step`}${steps.length === 0 ? "; there is none" : `: ${steps.map(({ name }) => name).join(", ")}`}.`,
      };
    },
  },
  {
    name: "comparison",
    label: "Comparison",
    description: `For observation, result and duration: one of ${COMPARISONS.join(", ")}, as the type of what it compares allows. Two lists are equal only with the same values in the same order; has the same values as ignores the order; contains and does not contain take one entry.`,
    type: "choice",
    options: COMPARISONS,
    required: false,
    offered: (place) => {
      const type = comparedType(place.record, place.content, place.module);
      if (type == null) return { values: COMPARISONS, rule: "" };
      const allowed = comparisonsFor(type);
      return { values: allowed, rule: `a ${describeType(type, place.module)} is compared by ${allowed.join(", ")}.` };
    },
  },
  {
    name: "expected",
    label: "Expected value",
    description: "For observation, result and duration: the value it is compared with, of the type the comparison takes.",
    type: "record",
    fields: valueFields("expected"),
    required: false,
  },
  {
    name: "refusal",
    label: "Refusal",
    description: "For refusal: the name of a refusal the step's action declares.",
    type: "text",
    required: false,
    offered: (place) => {
      const step = stepsOf(place.content, place.module).find((candidate) => candidate.name !== "" && candidate.name === textValue(place.record.step));
      const refusals = step?.operation?.refusals ?? [];
      return { values: refusals, rule: step?.operation == null ? "name the refused step first." : `${step.operation.code} declares ${refusals.length === 0 ? "no refusal" : refusals.join(", ")}.` };
    },
  },
];

/** The ways a value is given, each with how a refusal names it. */
const SOURCES = { literal: "a value written out", empty: "empty chosen", column: "a column", step: "a step's result" } as const;

type Source = keyof typeof SOURCES;

/** The ways a step's input or a Then step's expected value is given. */
const VALUE_SOURCES: readonly Source[] = ["literal", "empty", "column", "step"];

/** The ways a table row's cell is given. */
const CELL_SOURCES: readonly Source[] = ["literal", "empty"];

/** The problems of a value: exactly one of the ways its place allows, a literal of the type, empty chosen only where the type is possibly empty. */
function valueProblems(value: RecordContent, label: string, type: ValueType | null, sources: readonly Source[], module: ModuleReader): string[] {
  const given = sources.filter((source) => (source === "empty" ? flagValue(value.empty) : textValue(value[source]) !== ""));
  const ways = sources.map((source) => SOURCES[source]);
  const listed = `${ways.slice(0, -1).join(", ")} or ${ways.at(-1)}`;
  if (given.length === 0) return [`${label} has no value: give one of ${listed}.`];
  if (given.length > 1) return [`${label} takes exactly one of ${listed}.`];
  if (type == null) return [];
  const problem = given[0] === "literal" ? literalProblem(type, textValue(value.literal), module) : given[0] === "empty" ? emptyProblem(type, module) : null;
  return problem == null ? [] : [`${label}: ${problem}`];
}

/** The problems of a step's input values against its operation's inputs. */
function inputProblems(record: RecordContent, label: string, operation: Operation | null, module: ModuleReader): string[] {
  if (operation == null) return [];
  const values = recordsValue(record.inputs);
  const problems: string[] = [];
  for (const input of operation.inputs) {
    const given = values.filter((value) => textValue(value.input) === input.name);
    if (given.length === 0) problems.push(`${label} gives no value for the input ${input.name} of ${operation.code}.`);
    if (given.length > 1) problems.push(`${label} gives the input ${input.name} more than one value.`);
  }
  for (const value of values) {
    const input = operation.inputs.find(({ name }) => name === textValue(value.input));
    if (input != null) problems.push(...valueProblems(value, `${label}'s input ${input.name}`, input.type, VALUE_SOURCES, module));
  }
  return problems;
}

function presence(record: RecordContent, field: string): boolean {
  const value = record[field];
  return Array.isArray(value) ? value.length > 0 : value != null && value !== "";
}

export function checkAbstractTest(content: ItemContent, module: ModuleReader): string[] {
  const problems: string[] = [];
  const steps = stepsOf(content, module);
  const names = steps.map(({ name }) => name).filter((name) => name !== "");
  for (const name of new Set(names.filter((name, index) => names.indexOf(name) !== index))) {
    problems.push(`two steps are named ${name}; each step's name is its own.`);
  }
  for (const step of steps) problems.push(...inputProblems(step.record, stepLabel(step.section, step.index), step.operation, module));

  const thens = recordsValue(content.then);
  const refused = new Set(thens.filter((then) => textValue(then.expects) === "refusal").map((then) => textValue(then.step)));
  thens.forEach((then, index) => {
    const label = stepLabel(THEN, index);
    const expects = textValue(then.expects);
    const needs: Record<string, readonly string[]> = {
      observation: ["operation", "comparison", "expected"],
      result: ["step", "comparison", "expected"],
      duration: ["step", "comparison", "expected"],
      refusal: ["step", "refusal"],
    };
    const needed = needs[expects] ?? [];
    for (const field of ["operation", "inputs", "step", "comparison", "expected", "refusal"]) {
      const isNeeded = needed.includes(field) || (field === "inputs" && expects === "observation");
      if (needed.includes(field) && !presence(then, field)) problems.push(`${label} expects ${expects === "observation" ? "an observation" : `a ${expects}`}, so it needs its ${field}.`);
      if (!isNeeded && presence(then, field)) problems.push(`${label} expects ${expects === "observation" ? "an observation" : `a ${expects}`}, so it has no ${field}.`);
    }
    if (expects === "observation") problems.push(...inputProblems(then, label, operationOf(module, chosenItems(then.operation)[0]), module));
    const expected = recordValue(then.expected);
    if (expected != null && expects !== "refusal") {
      const compared = comparedType(then, content, module);
      problems.push(...valueProblems(expected, `${label}'s expected value`, compared == null ? null : expectedTypeOf(textValue(then.comparison), compared), VALUE_SOURCES, module));
    }
    if (expects === "result" && refused.has(textValue(then.step))) {
      problems.push(`${label} compares the result of ${textValue(then.step)}, which a Then step expects to be refused.`);
    }
  });

  const uses = (record: RecordContent | null, source: "column" | "step") => (record == null ? [] : [textValue(record[source])]);
  const values = [
    ...[...steps.map(({ record }) => record), ...thens].flatMap((record) => recordsValue(record.inputs)),
    ...thens.map((then) => recordValue(then.expected)).filter((value): value is RecordContent => value != null),
  ];
  for (const name of refused) {
    if (values.some((value) => uses(value, "step").includes(name))) problems.push(`a step uses the result of ${name}, which a Then step expects to be refused.`);
  }

  const columns = columnsOf(content);
  const columnNames = columns.map(({ name }) => name);
  for (const name of new Set(columnNames.filter((name, index) => columnNames.indexOf(name) !== index))) problems.push(`two columns are named ${name}.`);
  recordsValue(content.columns).forEach((column, index) => {
    const parsed = parseType(recordValue(column.type));
    if ("problem" in parsed) problems.push(`column ${textValue(column.name) || index + 1}'s type ${parsed.problem}`);
    else if (holdsEntities(parsed.type)) problems.push(`column ${textValue(column.name)} holds entities; a column holds values written out, never entities.`);
  });
  const usedColumns = new Set(values.flatMap((value) => uses(value, "column")));
  for (const name of columnNames) {
    if (!usedColumns.has(name)) problems.push(`no step uses the column ${name}.`);
  }
  const rows = recordsValue(content.rows);
  if (columns.length > 0 && rows.length === 0) problems.push("its table has columns but no row; give at least one row.");
  if (columns.length === 0 && rows.length > 0) problems.push("its table has rows but no column.");
  rows.forEach((row, index) => {
    const cells = recordsValue(row.cells);
    if (cells.length !== columns.length) {
      problems.push(`row ${index + 1} gives ${cells.length} cells for ${columns.length} columns; give each column one cell, in the columns' order.`);
      return;
    }
    columns.forEach((column, position) => {
      const type = column.type == null || holdsEntities(column.type) ? null : column.type;
      problems.push(...valueProblems(cells[position]!, `row ${index + 1}, column ${column.name}`, type, CELL_SOURCES, module));
    });
  });
  return problems;
}

/** A value as a sentence or the table shows it: written out, empty, a column's name in angle brackets, or a step's name. */
function valueText(value: RecordContent | null): string {
  if (value == null) return "…";
  if (textValue(value.literal) !== "") return textValue(value.literal);
  if (flagValue(value.empty)) return "empty";
  if (textValue(value.column) !== "") return `<${textValue(value.column)}>`;
  return textValue(value.step) || "…";
}

/** A step calling an operation, as a sentence shows it: the operation's kind and its phrase with the step's values in place. */
function callText(record: RecordContent, module: ModuleReader): string {
  const operation = operationOf(module, chosenItems(record.operation)[0]);
  if (operation == null) return "(an operation not chosen)";
  const values = recordsValue(record.inputs);
  const filled = fillPhrase(operation.phrase, (input) => {
    const value = values.find((candidate) => textValue(candidate.input) === input);
    return value == null ? `{${input}}` : valueText(value);
  });
  return `(${operation.kind ?? "operation"}) ${filled}`;
}

function thenText(then: RecordContent, module: ModuleReader): string {
  const step = textValue(then.step);
  const comparison = `${comparisonWords(textValue(then.comparison))} ${valueText(recordValue(then.expected))}`;
  switch (textValue(then.expects)) {
    case "observation":
      return `${callText(then, module)} ${comparison}`;
    case "result":
      return `${step} ${comparison}`;
    case "duration":
      return `how long ${step} took ${comparison}`;
    default:
      return `${step} is refused with ${textValue(then.refusal)}`;
  }
}

function sentences(word: string, lines: readonly string[]): string[] {
  return lines.map((line, index) => `${index === 0 ? word : "  and"} ${line}`);
}

export function displayAbstractTest(parts: ShownParts): string {
  const { content, module } = parts;
  const criterion = module.item(chosenItems(content.criterion)[0] ?? "");
  const stepText = (record: RecordContent) => `${callText(record, module)}${textValue(record.name) === "" ? "" : `, as ${textValue(record.name)}`}`;
  const columns = columnsOf(content).map(({ name }) => name);
  const rows = recordsValue(content.rows).map((row) => recordsValue(row.cells).map(valueText));
  return [
    `Verifies ${criterion == null ? "no acceptance criterion" : `${criterion.code}: ${criterion.text.split("\n").join(" ")}`}`,
    "",
    ...sentences("Given", recordsValue(content.given).map(stepText)),
    ...sentences("When", recordsValue(content.when).map(stepText)),
    ...sentences("Then", recordsValue(content.then).map((then) => thenText(then, module))),
    ...(columns.length === 0 ? [] : ["", "One test for each row:", columns.join(" | "), ...rows.map((row) => row.join(" | "))]),
  ].join("\n");
}

export function marksOfAbstractTest(parts: ShownParts): string[] {
  const directSetup = recordsValue(parts.content.given).some((step) => operationOf(parts.module, chosenItems(step.operation)[0])?.kind === DIRECT_SETUP);
  return directSetup ? ["Given uses a direct setup"] : [];
}
