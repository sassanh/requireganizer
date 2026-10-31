import { fingerprint } from "./hash";

/** A field's value: text for a text or choice field, item ids for an items field, or null for none. */
export type FieldValue = string | readonly string[] | null;

/** An item's content: its kind's fields by name. */
export type ItemContent = Readonly<Record<string, FieldValue>>;

/** The item ids an items field's value chooses. */
export function chosenItems(value: FieldValue | undefined): readonly string[] {
  return Array.isArray(value) ? value : [];
}

/** A text or choice field's value, or "" when it has none. */
export function textValue(value: FieldValue | undefined): string {
  return typeof value === "string" ? value : "";
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
  at: string;
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
