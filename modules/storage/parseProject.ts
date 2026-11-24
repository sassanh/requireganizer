import { exactRecord, InvalidJsonError, isRecord, readText, readTexts } from "lib/json";
import { assertModuleNameAvailable, normalizeModuleName } from "modules";
import { Store, WORKFLOW } from "store";
import { isFieldValue, type ItemVersion } from "workflow";

import { PROJECT_SCHEMA_VERSION, type ModuleContent, type ModuleState, type ProjectState } from "./projectState";

function checkTime(value: unknown, label: string): void {
  if (value !== null && typeof value !== "string") throw new InvalidJsonError(`${label} must be a time or null.`);
}

function checkEntries(value: unknown, label: string, check: (entry: unknown, entryLabel: string) => void): void {
  if (!isRecord(value)) throw new InvalidJsonError(`${label} must be an object.`);
  for (const [key, entry] of Object.entries(value)) check(entry, `${label} ${key}`);
}

function checkList(value: unknown, label: string, check: (entry: unknown, entryLabel: string) => void): void {
  if (!Array.isArray(value)) throw new InvalidJsonError(`${label} must be a list.`);
  value.forEach((entry, index) => check(entry, `${label} ${index + 1}`));
}

function checkSigner(value: unknown, label: string): void {
  const kind = isRecord(value) ? value.kind : undefined;
  if (kind === "person") {
    exactRecord(value, label, ["kind"]);
    return;
  }
  if (kind === "model") {
    readText(exactRecord(value, label, ["kind", "model"]).model, `${label} model`);
    return;
  }
  throw new InvalidJsonError(`${label} must be the spec owner or a model.`);
}

function checkAuthor(value: unknown, label: string): void {
  if (isRecord(value) && value.kind === "agent") {
    readText(exactRecord(value, label, ["kind", "name"]).name, `${label} name`);
    return;
  }
  checkSigner(value, label);
}

function checkContent(value: unknown, label: string): void {
  if (!isRecord(value) || !Object.values(value).every(isFieldValue)) {
    throw new InvalidJsonError(`${label} must map field names to text, true or false, a list of texts or item ids, a record, a list of records, or null.`);
  }
}

function checkVersion(value: unknown, label: string): void {
  const version = exactRecord(value, label, ["content", "references", "dependencies"]);
  checkContent(version.content, `${label} content`);
  readTexts(version.references, `${label} references`);
  readTexts(version.dependencies, `${label} dependencies`);
}

/** An item's version as stored, read; throws what is wrong with it. */
export function parseItemVersion(value: unknown, label: string): ItemVersion {
  checkVersion(value, label);
  return value as ItemVersion;
}

/** A signature's shared keys and the ones its kind adds, checked. */
function signatureRecord(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  const signature = exactRecord(value, label, ["signer", "at", "covers", ...keys], ["set"]);
  checkSigner(signature.signer, `${label} signer`);
  checkTime(signature.at, `${label} time`);
  readText(signature.covers, `${label} covers`);
  if (Object.hasOwn(signature, "set")) {
    const set = exactRecord(signature.set, `${label} set`, ["proposal", "agent"]);
    readText(set.proposal, `${label} set proposal`);
    readText(set.agent, `${label} set agent`);
  }
  return signature;
}

function checkItemSignature(value: unknown, label: string): void {
  if (value === null) return;
  const signature = signatureRecord(value, label, ["version", "basis"]);
  checkVersion(signature.version, `${label} version`);
  checkEntries(signature.basis, `${label} basis`, readText);
}

function checkRemoval(value: unknown, label: string): void {
  if (value === null) return;
  const removal = exactRecord(value, label, ["signature"]);
  if (removal.signature === null) return;
  const signatureLabel = `${label} signature`;
  checkVersion(signatureRecord(removal.signature, signatureLabel, ["version"]).version, `${signatureLabel} version`);
}

function checkCoverage(value: unknown, label: string): void {
  const coverage = signatureRecord(value, label, ["item", "referencing"]);
  const checkLinked = (entry: unknown, entryLabel: string) => {
    const linked = exactRecord(entry, entryLabel, ["id", "version"]);
    readText(linked.id, `${entryLabel} id`);
    checkVersion(linked.version, `${entryLabel} version`);
  };
  checkLinked(coverage.item, `${label} item`);
  checkList(coverage.referencing, `${label} referencing item`, checkLinked);
}

function checkImpact(value: unknown, label: string): void {
  const impact = signatureRecord(value, label, ["before", "after"]);
  checkVersion(impact.before, `${label} before`);
  if (impact.after !== null) checkVersion(impact.after, `${label} after`);
}

function checkItem(stage: string, value: unknown, label: string, ids: Set<string>): void {
  const item = exactRecord(value, label, ["id", "kind", "content", "references", "dependencies", "basis", "signature", "removal"]);
  if (typeof item.id !== "string" || item.id.length === 0) throw new InvalidJsonError(`${label} has no id.`);
  if (ids.has(item.id)) throw new InvalidJsonError(`${label} has the id ${item.id}, which another item has.`);
  ids.add(item.id);
  if (!WORKFLOW.isKind(item.kind) || WORKFLOW.stageOfKind(item.kind) !== stage) {
    throw new InvalidJsonError(`${label} has kind ${JSON.stringify(item.kind)}, which ${WORKFLOW.stage(stage).label} does not hold.`);
  }
  checkContent(item.content, `${label} content`);
  readTexts(item.references, `${label} references`);
  readTexts(item.dependencies, `${label} dependencies`);
  checkEntries(item.basis, `${label} basis`, readText);
  checkItemSignature(item.signature, `${label} signature`);
  checkRemoval(item.removal, `${label} removal`);
}

function checkMessage(value: unknown, label: string): void {
  const message = exactRecord(value, label, ["id", "author", "text", "at"], ["withChanges", "annotations"]);
  readText(message.id, `${label} id`);
  if (Object.hasOwn(message, "annotations") && !isRecord(message.annotations)) {
    throw new InvalidJsonError(`${label} annotations must be an object.`);
  }
  checkAuthor(message.author, `${label} author`);
  readText(message.text, `${label} text`);
  checkTime(message.at, `${label} time`);
  if (Object.hasOwn(message, "withChanges") && message.withChanges !== true) {
    throw new InvalidJsonError(`${label} withChanges must be true when present.`);
  }
}

function checkThread(value: unknown, label: string): void {
  const thread = exactRecord(value, label, ["id", "unitId", "stage", "removedUnit", "messages", "resolution"]);
  readText(thread.id, `${label} id`);
  if (thread.unitId !== null) readText(thread.unitId, `${label} unit id`);
  if (!WORKFLOW.isStage(thread.stage)) throw new InvalidJsonError(`${label} is in ${JSON.stringify(thread.stage)}, which is no stage.`);
  if (thread.removedUnit !== null && thread.unitId === null) throw new InvalidJsonError(`${label} is on its stage, so it has no removed unit.`);
  if (thread.removedUnit !== null) {
    const removed = exactRecord(thread.removedUnit, `${label} removed unit`, ["name", "text"]);
    readText(removed.name, `${label} removed unit name`);
    readText(removed.text, `${label} removed unit text`);
  }
  if (!Array.isArray(thread.messages) || thread.messages.length === 0) {
    throw new InvalidJsonError(`${label} must have at least one message.`);
  }
  checkList(thread.messages, `${label} message`, checkMessage);
  if (thread.resolution !== null) checkTime(exactRecord(thread.resolution, `${label} resolution`, ["at"]).at, `${label} resolution time`);
}

/**
 * A module's content, checked: every stage is one the workflow defines,
 * every item is of a kind its stage holds, and every record has exactly the
 * keys Requireganizer stores. It is returned as given.
 */
function parseModuleContent(value: unknown, label: string): ModuleContent {
  const content = exactRecord(value, label, ["stages", "threads"]);
  if (!isRecord(content.stages)) throw new InvalidJsonError(`${label} stages must be an object.`);
  const ids = new Set<string>();
  for (const [stage, entry] of Object.entries(content.stages)) {
    if (!WORKFLOW.isStage(stage)) throw new InvalidJsonError(`${label} has a stage ${JSON.stringify(stage)}, which is no stage.`);
    const stageLabel = `${label}, ${WORKFLOW.stage(stage).label}`;
    const stored = exactRecord(entry, stageLabel, ["items", "intake", "coverages", "impacts", "completedAt"]);
    checkTime(stored.completedAt, `${stageLabel} completion time`);
    checkList(stored.items, `${stageLabel} item`, (item, itemLabel) => checkItem(stage, item, itemLabel, ids));
    checkEntries(stored.intake, `${stageLabel} intake of`, checkVersion);
    checkEntries(stored.coverages, `${stageLabel} coverage of`, checkCoverage);
    checkEntries(stored.impacts, `${stageLabel} impact on`, checkImpact);
  }
  checkList(content.threads, `${label} thread`, checkThread);
  if (!Store.is(content)) throw new InvalidJsonError(`${label} does not have the shape Requireganizer stores.`);
  return content as unknown as ModuleContent;
}

function parseModule(
  value: unknown,
  index: number,
  modules: readonly ModuleState[],
  known: ModuleContent | null,
): ModuleState {
  const label = `Module ${index + 1}`;
  const stored = exactRecord(value, label, ["id", "name", "archivedAt", "content"]);
  if (typeof stored.id !== "string" || stored.id.length === 0) throw new InvalidJsonError(`${label} has no id.`);
  if (modules.some(({ id }) => id === stored.id)) throw new InvalidJsonError(`${label} has the id ${stored.id}, which another module has.`);
  const name = normalizeModuleName(stored.name);
  if (name !== stored.name) throw new InvalidJsonError(`${label} name “${String(stored.name)}” has spaces Requireganizer would not store.`);
  // The one name-uniqueness rule, so imports and the interface refuse the same names.
  assertModuleNameAvailable(name, modules);
  checkTime(stored.archivedAt, `Module “${name}” archive time`);
  const content = known ?? parseModuleContent(stored.content, `Module “${name}”`);
  return { id: stored.id, name, archivedAt: stored.archivedAt as string | null, content };
}

/**
 * The one reader of a stored or exported project. It refuses anything an
 * export could not have written, such as a key Requireganizer does not
 * store or one it stores that is missing, and keeps everything it accepts
 * exactly as given. `knownContents` gives, by a module's place, a content
 * this reader already read, which is taken as it is.
 */
export function parseProject(value: unknown, knownContents: readonly (ModuleContent | null)[] = []): ProjectState {
  if (isRecord(value) && value.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new InvalidJsonError(
      `This project uses schema ${JSON.stringify(value.schemaVersion)}. Requireganizer reads schema ${PROJECT_SCHEMA_VERSION} only.`,
    );
  }
  const document = exactRecord(value, "The project", ["schemaVersion", "modulesEnabled", "modules"]);
  if (typeof document.modulesEnabled !== "boolean") throw new InvalidJsonError("The project must say whether modules are enabled.");
  if (!Array.isArray(document.modules) || document.modules.length === 0) throw new InvalidJsonError("The project must hold at least one module.");
  const modules: ModuleState[] = [];
  document.modules.forEach((entry, index) => modules.push(parseModule(entry, index, modules, knownContents[index] ?? null)));
  if (modules.every(({ archivedAt }) => archivedAt != null)) throw new InvalidJsonError("Every module of the project is archived.");
  return { modulesEnabled: document.modulesEnabled, modules };
}
