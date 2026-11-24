import type { AgentId } from "agents/record";
import { isRecord } from "lib/json";
import { coverageUnitId, impactUnitId, type Thread, type ThreadMessage } from "workflow";

/** The key Delegation's annotations of a thread message are kept under. */
const OWN = "delegation";

/**
 * The unit a reply's note is on: an item of any module, by its id, or its
 * coverage or impact in a stage; with what the unit was when the note was
 * given, its revision for an item and what a signature on it covered for
 * a coverage or an impact.
 */
export interface NotedUnit {
  itemId: string;
  unit?: { kind: "coverage" | "impact"; stage: string };
  revision: string;
  /** The agent that gave the note had taken part in the unit when it gave it. */
  ownWork?: true;
}

/** What an agent's reply finds wrong with a unit: the unit, a published rule that applies to it that it breaks, and how. */
export interface Finding extends NotedUnit {
  rule: string;
  how: string;
}

/** What an agent's reply names on a unit it leaves out of its proposal: the choice the unit makes that the items it rests on leave open. */
export interface Choice extends NotedUnit {
  choice: string;
}

/** A unit of a proposal: the unit, of the thread's stage, and what a signature on it covered when the agent reviewed it. */
export interface ProposedUnit {
  unitId: string;
  covers: string;
  /** The agent that proposed it had taken part in it when it proposed it. */
  ownWork?: true;
}

/** The workflow's id of the unit a note is on. */
export function notedUnitId(noted: Pick<NotedUnit, "itemId" | "unit">): string {
  return noted.unit == null ? noted.itemId : noted.unit.kind === "coverage" ? coverageUnitId(noted.unit.stage, noted.itemId) : impactUnitId(noted.unit.stage, noted.itemId);
}

/** What a thread asks of the agent it is assigned to: an answer to the spec owner's message, or the update or a review of the thread's stage. */
export type AskKind = "message" | "update" | "review";

/** What Delegation says of an agent's reply: the agent that wrote it, its findings and choices, and the proposal it gives, if any. */
export interface ReplyNotes {
  agentId: AgentId;
  findings: Finding[];
  choices: Choice[];
  proposal: ProposedUnit[] | null;
}

function own(message: Pick<ThreadMessage, "annotations">): Record<string, unknown> | null {
  const value = message.annotations?.[OWN];
  return isRecord(value) ? value : null;
}

/** The annotation of the spec owner's message that asks for a stage to be updated or reviewed. */
export function asksAnnotation(kind: "update" | "review"): Readonly<Record<string, unknown>> {
  return { [OWN]: { asks: kind } };
}

/** What a thread asks: what its first message asked, for a thread opened by asking for its stage to be updated or reviewed, else an answer to the spec owner's message. */
export function threadAsks(thread: Thread): AskKind {
  const asks = own(thread.messages[0]!)?.asks;
  return asks === "update" || asks === "review" ? asks : "message";
}

/** The annotation of an agent's reply. */
export function replyAnnotation(notes: ReplyNotes): Readonly<Record<string, unknown>> {
  return {
    [OWN]: {
      agentId: notes.agentId,
      ...(notes.findings.length === 0 ? {} : { findings: notes.findings }),
      ...(notes.choices.length === 0 ? {} : { choices: notes.choices }),
      ...(notes.proposal == null ? {} : { proposal: notes.proposal }),
    },
  };
}

/** The agent that wrote a reply, as its annotation says; null for a message Delegation did not annotate. */
export function replyAgent(message: Pick<ThreadMessage, "annotations">): AgentId | null {
  const agentId = own(message)?.agentId;
  return typeof agentId === "string" ? agentId : null;
}

/** The mark of own work an entry carries, as a note keeps it. */
function ownWorkOf(entry: Record<string, unknown>): { ownWork?: true } {
  return entry.ownWork === true ? { ownWork: true } : {};
}

function notedUnit(entry: Record<string, unknown>): NotedUnit | null {
  if (typeof entry.itemId !== "string" || typeof entry.revision !== "string") return null;
  if (entry.unit == null) return { itemId: entry.itemId, revision: entry.revision, ...ownWorkOf(entry) };
  const unit = entry.unit;
  if (!isRecord(unit) || (unit.kind !== "coverage" && unit.kind !== "impact") || typeof unit.stage !== "string") return null;
  return { itemId: entry.itemId, unit: { kind: unit.kind, stage: unit.stage }, revision: entry.revision, ...ownWorkOf(entry) };
}

function entriesOf(message: Pick<ThreadMessage, "annotations">, key: string): Record<string, unknown>[] {
  const value = own(message)?.[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** The findings a reply gives. */
export function findingsOf(message: Pick<ThreadMessage, "annotations">): Finding[] {
  return entriesOf(message, "findings").flatMap((entry): Finding[] => {
    const noted = notedUnit(entry);
    return noted != null && typeof entry.rule === "string" && typeof entry.how === "string" ? [{ ...noted, rule: entry.rule, how: entry.how }] : [];
  });
}

/** The choices a reply names. */
export function choicesOf(message: Pick<ThreadMessage, "annotations">): Choice[] {
  return entriesOf(message, "choices").flatMap((entry): Choice[] => {
    const noted = notedUnit(entry);
    return noted != null && typeof entry.choice === "string" ? [{ ...noted, choice: entry.choice }] : [];
  });
}

/** The proposal a reply gives; null for a reply that gives none. */
export function proposalOf(message: Pick<ThreadMessage, "annotations">): ProposedUnit[] | null {
  if (!Array.isArray(own(message)?.proposal)) return null;
  return entriesOf(message, "proposal").flatMap((entry): ProposedUnit[] => (typeof entry.unitId === "string" && typeof entry.covers === "string" ? [{ unitId: entry.unitId, covers: entry.covers, ...ownWorkOf(entry) }] : []));
}
