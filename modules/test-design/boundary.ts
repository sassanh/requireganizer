import { flagValue, type ItemContent, type ModuleReader, recordsValue, recordValue, type ShownParts, textsValue, textValue } from "workflow";

import { ACTION, DIRECT_SETUP, ENTITY_TYPE, OBSERVATION, OPERATION, type OperationKind, WORD_SET } from "./identifiers";
import { describeWrittenType, parseType, typeOf, type ValueType } from "./valueTypes";

/** The kinds whose names are unique within a module's boundary. */
const NAMED_KINDS = [ENTITY_TYPE, WORD_SET, OPERATION];

/** An operation as abstract tests use it. */
export interface Operation {
  id: string;
  code: string;
  kind: OperationKind | null;
  name: string;
  phrase: string;
  inputs: { name: string; type: ValueType | null }[];
  result: ValueType | null;
  refusals: string[];
  completesLater: boolean;
  /** The acceptance criteria and other items it references. */
  references: readonly string[];
}

export function operationOf(module: ModuleReader, id: string | undefined): Operation | null {
  const item = id == null ? null : module.item(id);
  if (item == null || item.kind !== OPERATION) return null;
  const { content } = item;
  const kind = textValue(content.kind);
  return {
    id: item.id,
    code: item.code,
    kind: kind === "" ? null : (kind as OperationKind),
    name: textValue(content.name),
    phrase: textValue(content.phrase),
    inputs: recordsValue(content.inputs).map((input) => ({ name: textValue(input.name), type: typeOf(recordValue(input.type)) })),
    result: typeOf(recordValue(content.result)),
    refusals: recordsValue(content.refusals).map((refusal) => textValue(refusal.name)),
    completesLater: flagValue(content.completesLater),
    references: item.references,
  };
}

/** The places a phrase holds, by the input names written in braces. */
export function phrasePlaces(phrase: string): string[] {
  return [...phrase.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1]!.trim());
}

/** A phrase with each place filled by `fill`, given the input name. */
export function fillPhrase(phrase: string, fill: (input: string) => string): string {
  return phrase.replace(/\{([^{}]*)\}/g, (_whole, input: string) => fill(input.trim()));
}

function duplicates(names: readonly string[]): string[] {
  return [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
}

/** The problem of a name another entity type, set of words or operation of the boundary already has, ignoring case. */
function nameProblems(content: ItemContent, module: ModuleReader, itemId: string): string[] {
  const name = textValue(content.name).toLowerCase();
  const clash = NAMED_KINDS.flatMap((kind) => module.itemsOf(kind)).find(
    (item) => item.id !== itemId && textValue(item.content.name).toLowerCase() === name,
  );
  return clash == null ? [] : [`its name "${textValue(content.name)}" is already ${clash.code}'s; names of entity types, sets of words and operations are unique in the boundary.`];
}

export function checkEntityType(content: ItemContent, module: ModuleReader, itemId: string): string[] {
  return nameProblems(content, module, itemId);
}

export function checkWordSet(content: ItemContent, module: ModuleReader, itemId: string): string[] {
  const repeated = duplicates(textsValue(content.words));
  return [...nameProblems(content, module, itemId), ...(repeated.length === 0 ? [] : [`it holds ${repeated.join(", ")} more than once.`])];
}

export function checkOperation(content: ItemContent, module: ModuleReader, itemId: string): string[] {
  const problems = nameProblems(content, module, itemId);
  const kind = textValue(content.kind);
  const inputs = recordsValue(content.inputs);
  const names = inputs.map((input) => textValue(input.name));
  for (const name of duplicates(names)) problems.push(`two inputs are named ${name}; each input's name is its own.`);
  inputs.forEach((input, index) => {
    const parsed = parseType(recordValue(input.type));
    if ("problem" in parsed) problems.push(`input ${index + 1}'s type ${parsed.problem}`);
  });
  const places = phrasePlaces(textValue(content.phrase));
  for (const name of names) {
    if (!places.includes(name)) problems.push(`its phrase holds no place for the input ${name}; write {${name}} where it goes.`);
  }
  for (const place of places) {
    if (!names.includes(place)) problems.push(`its phrase holds a place {${place}}, which names no input.`);
  }
  const result = recordValue(content.result);
  if (result != null) {
    const parsed = parseType(result);
    if ("problem" in parsed) problems.push(`its result ${parsed.problem}`);
  } else if (kind === OBSERVATION) {
    problems.push("an observation reports a value, so its result cannot be none.");
  }
  const refusals = recordsValue(content.refusals);
  if (refusals.length > 0 && kind !== ACTION) problems.push(`only an action declares refusals; this is a ${kind}.`);
  for (const name of duplicates(refusals.map((refusal) => textValue(refusal.name)))) {
    problems.push(`two refusals are named ${name}; each refusal's name is its own.`);
  }
  if (flagValue(content.completesLater) && kind === DIRECT_SETUP) problems.push("only an action or an observation completes later.");
  const reason = textValue(content.reason);
  if (kind === DIRECT_SETUP && reason === "") problems.push("a direct setup needs its reason: why the product's actions cannot build the state it puts in place.");
  if (kind !== DIRECT_SETUP && reason !== "") problems.push(`only a direct setup has a reason; this is a ${kind}.`);
  return problems;
}

export function displayBoundaryStatement(parts: ShownParts): string {
  return [
    `Tests act on and observe: ${parts.text("actsOn")}`,
    ...(parts.text("leavesOut") === "" ? [] : [`They leave out: ${parts.text("leavesOut")}`]),
    `Every test starts from: ${parts.text("startingState")}`,
  ].join("\n");
}

export function displayOperation(parts: ShownParts): string {
  const { content, module } = parts;
  const kind = parts.text("kind");
  const inputs = recordsValue(content.inputs);
  const refusals = recordsValue(content.refusals);
  return [
    `${kind.charAt(0).toUpperCase()}${kind.slice(1)} "${parts.text("name")}": ${parts.text("phrase")}`,
    ...(inputs.length === 0 ? [] : [`Inputs: ${inputs.map((input) => `${textValue(input.name)}, ${describeWrittenType(recordValue(input.type), module)}`).join("; ")}`]),
    `Result: ${describeWrittenType(recordValue(content.result), module)}`,
    ...(refusals.length === 0 ? [] : [`Refusals: ${refusals.map((refusal) => `${textValue(refusal.name)}, meaning ${textValue(refusal.meaning)}`).join("; ")}`]),
    ...(flagValue(content.completesLater) ? ["Completes some time after it is called."] : []),
    ...(parts.text("reason") === "" ? [] : [`Put in place directly because ${parts.text("reason")}`]),
  ].join("\n");
}

