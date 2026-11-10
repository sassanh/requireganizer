import { fingerprint } from "./hash";

/**
 * A field's value: text for a text or choice field, yes or no for a flag,
 * texts for a texts field, item ids for an items field, a record for a
 * record field, records for a records field, or null for none.
 */
export type FieldValue = string | boolean | readonly string[] | RecordContent | readonly RecordContent[] | null;

/** A record's content: its fields by name. */
export interface RecordContent {
  readonly [field: string]: FieldValue;
}

/** An item's content: its kind's fields by name. */
export type ItemContent = RecordContent;

function isRecordContent(value: FieldValue | undefined): value is RecordContent {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** The item ids an items field's value chooses, or the texts of a texts field. */
export function chosenItems(value: FieldValue | undefined): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** The texts a texts field holds. */
export const textsValue = chosenItems;

/** A text or choice field's value, or "" when it has none. */
export function textValue(value: FieldValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/** A flag's value: false when it has none. */
export function flagValue(value: FieldValue | undefined): boolean {
  return value === true;
}

/** A record field's record, or null when it has none. */
export function recordValue(value: FieldValue | undefined): RecordContent | null {
  return isRecordContent(value) ? value : null;
}

/** A records field's records. */
export function recordsValue(value: FieldValue | undefined): readonly RecordContent[] {
  return Array.isArray(value) ? value.filter((entry): entry is RecordContent => isRecordContent(entry as FieldValue)) : [];
}

/** Whether a value is one a field can hold in any shape, as a stored item's content is first checked. */
export function isFieldValue(value: unknown): value is FieldValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every((entry) => typeof entry === "string") || value.every((entry) => isFieldValue(entry) && isRecordContent(entry as FieldValue));
  return typeof value === "object" && Object.values(value as Record<string, unknown>).every(isFieldValue);
}

/** What an item states and links to: everything a signature on it covers. */
export interface ItemVersion {
  content: ItemContent;
  references: readonly string[];
  dependencies: readonly string[];
}

/** The hash of an item version, as a basis or a signature records it. */
export function revisionOf(version: ItemVersion): string {
  return fingerprint({
    content: version.content,
    references: version.references,
    dependencies: version.dependencies,
  });
}

/** Who gave a signature or wrote a message. */
export type Signer = { kind: "person" } | { kind: "model"; model: string };

export const SPEC_OWNER: Signer = { kind: "person" };

/** What every signature records: who gave it, when, and the hash of what it covers. */
export interface SignatureRecord {
  signer: Signer;
  /** Null in an export made without signature times. */
  at: string | null;
  covers: string;
}

/** A signature on an item: the version shown, and the versions of what it links to that it rests on. */
export interface ItemSignature extends SignatureRecord {
  version: ItemVersion;
  basis: Readonly<Record<string, string>>;
}

/** A signature on the removal of an item, given for the version removed. */
export interface RemovalSignature extends SignatureRecord {
  version: ItemVersion;
}

/** A proposed removal, signed or not. */
export interface Removal {
  signature: RemovalSignature | null;
}

/** A signature on a coverage: the covered item and the items referencing it, as shown. */
export interface CoverageSignature extends SignatureRecord {
  item: { id: string; version: ItemVersion };
  referencing: { id: string; version: ItemVersion }[];
}

/** A signature on an impact: the item's version as taken in before, and as it is now or null once removed. */
export interface ImpactSignature extends SignatureRecord {
  before: ItemVersion;
  after: ItemVersion | null;
}

/** The revision an impact's signature covers for a removed item. */
export function removedRevision(itemId: string): string {
  return fingerprint({ removed: itemId });
}

/** The revision a removal's signature covers. */
export function removalRevision(version: ItemVersion): string {
  return fingerprint({ removal: revisionOf(version) });
}

export function signerLabel(signer: Signer): string {
  return signer.kind === "person" ? "the spec owner" : signer.model;
}
