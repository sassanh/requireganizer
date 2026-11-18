import { isRecord } from "lib/json";

/** The name the Agents module's section of the project is kept under. */
export const AGENTS_SECTION = "agents";

/** A request to write or to review a stage, or the fulfilment of one, and when it was made. */
export interface StageRequest {
  stage: string;
  at: string;
}

/** A change request the spec owner withdrew: its thread, the place of the message that made it, and when. */
export interface WithdrawalNote {
  threadId: string;
  message: number;
  at: string;
}

/** An item an answer to a request to review found breaking a published rule, as the item was then. */
export interface ReviewFinding {
  itemId: string;
  /** The item's revision when it was found; the finding shows only while the item is still so. */
  revision: string;
  rule: string;
  how: string;
}

/** The last answer to a request to review a stage: the agent that gave it, when, and what it found. */
export interface ReviewAnswer {
  stage: string;
  agent: string;
  at: string;
  findings: ReviewFinding[];
}

/** What the Agents module keeps of one module of the project. */
export interface ModuleRequests {
  /** The waiting requests to write a stage. */
  write: StageRequest[];
  /** The waiting requests to review a stage. */
  review: StageRequest[];
  /** When the last request to write each stage was fulfilled. */
  fulfilled: StageRequest[];
  withdrawn: WithdrawalNote[];
  /** The last answer to a request to review each stage. */
  reviewAnswers: ReviewAnswer[];
}

/** The Agents module's section of the project: its requests and what came of them, by module. */
export interface AgentsSection {
  modules: Readonly<Record<string, ModuleRequests>>;
}

export const NO_REQUESTS: ModuleRequests = { write: [], review: [], fulfilled: [], withdrawn: [], reviewAnswers: [] };

const EMPTY_SECTION: AgentsSection = { modules: {} };

function list<Entry>(value: unknown, read: (entry: Record<string, unknown>) => Entry | null): Entry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const found = isRecord(entry) ? read(entry) : null;
    return found == null ? [] : [found];
  });
}

const text = (value: unknown): value is string => typeof value === "string";

const stageRequest = (entry: Record<string, unknown>): StageRequest | null => (text(entry.stage) && text(entry.at) ? { stage: entry.stage, at: entry.at } : null);

function moduleRequestsOf(value: unknown): ModuleRequests {
  if (!isRecord(value)) return NO_REQUESTS;
  return {
    write: list(value.write, stageRequest),
    review: list(value.review, stageRequest),
    fulfilled: list(value.fulfilled, stageRequest),
    withdrawn: list(value.withdrawn, (entry) =>
      text(entry.threadId) && typeof entry.message === "number" && text(entry.at) ? { threadId: entry.threadId, message: entry.message, at: entry.at } : null,
    ),
    reviewAnswers: list(value.reviewAnswers, (entry) =>
      text(entry.stage) && text(entry.agent) && text(entry.at)
        ? {
            stage: entry.stage,
            agent: entry.agent,
            at: entry.at,
            findings: list(entry.findings, (finding) =>
              text(finding.itemId) && text(finding.revision) && text(finding.rule) && text(finding.how)
                ? { itemId: finding.itemId, revision: finding.revision, rule: finding.rule, how: finding.how }
                : null,
            ),
          }
        : null,
    ),
  };
}

const parsed = new WeakMap<object, AgentsSection>();

/**
 * The section as the project keeps it, read: an entry it cannot read is
 * left out, and a missing part reads as empty.
 */
export function parseAgentsSection(value: unknown): AgentsSection {
  if (!isRecord(value) || !isRecord(value.modules)) return EMPTY_SECTION;
  const known = parsed.get(value);
  if (known != null) return known;
  const section = { modules: Object.fromEntries(Object.entries(value.modules).map(([moduleId, entry]) => [moduleId, moduleRequestsOf(entry)])) };
  parsed.set(value, section);
  return section;
}

/** What the section keeps of a module. */
export function requestsOfModule(section: AgentsSection, moduleId: string): ModuleRequests {
  return section.modules[moduleId] ?? NO_REQUESTS;
}

/** The section with one module's part changed. */
export function withModuleRequests(section: AgentsSection, moduleId: string, update: (requests: ModuleRequests) => ModuleRequests): AgentsSection {
  return { modules: { ...section.modules, [moduleId]: update(requestsOfModule(section, moduleId)) } };
}

/** The annotation an agent's message carries when it answers the change request of its thread. */
export const ANSWERS_REQUEST = { [AGENTS_SECTION]: { answersRequest: true } } as const;

/** Whether a message's annotations say it answers its thread's change request. */
export function answersRequest(annotations: Readonly<Record<string, unknown>> | undefined): boolean {
  const own = annotations?.[AGENTS_SECTION];
  return isRecord(own) && own.answersRequest === true;
}
