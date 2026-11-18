import { AGENTS_SECTION, type ModuleRequests, parseAgentsSection, requestsOfModule, type StageRequest } from "../section";

/** One line of how a section of the project differs: its sign, as the difference lists show them, and what it says. */
export interface SectionLine {
  sign: "+" | "−" | "~";
  text: string;
}

const keyOf = ({ stage, at }: StageRequest) => `${stage} ${at}`;

/** What `then` holds of a list and `now` does not, by key. */
function added<Entry>(then: readonly Entry[], now: readonly Entry[], key: (entry: Entry) => string): Entry[] {
  const held = new Set(now.map(key));
  return then.filter((entry) => !held.has(key(entry)));
}

function moduleLines(then: ModuleRequests, now: ModuleRequests, stageLabel: (stage: string) => string): SectionLine[] {
  const lines: SectionLine[] = [];
  for (const kind of ["write", "review"] as const) {
    const asked = kind === "write" ? "the writing of" : "a review of";
    for (const ask of added(then[kind], now[kind], keyOf)) lines.push({ sign: "+", text: `Asked for ${asked} ${stageLabel(ask.stage)}` });
    for (const ask of added(now[kind], then[kind], keyOf)) lines.push({ sign: "−", text: `No longer asked for ${asked} ${stageLabel(ask.stage)}` });
  }
  for (const done of added(then.fulfilled, now.fulfilled, keyOf)) lines.push({ sign: "+", text: `Writing of ${stageLabel(done.stage)} fulfilled` });
  const noteKey = ({ threadId, message }: ModuleRequests["withdrawn"][number]) => `${threadId} ${message}`;
  for (const _note of added(then.withdrawn, now.withdrawn, noteKey)) lines.push({ sign: "−", text: "A change request withdrawn" });
  for (const _note of added(now.withdrawn, then.withdrawn, noteKey)) lines.push({ sign: "+", text: "A withdrawn change request waits again" });
  const answerKey = ({ stage, at }: ModuleRequests["reviewAnswers"][number]) => `${stage} ${at}`;
  for (const answer of added(then.reviewAnswers, now.reviewAnswers, answerKey)) lines.push({ sign: "+", text: `${answer.agent}'s review of ${stageLabel(answer.stage)}` });
  for (const answer of added(now.reviewAnswers, then.reviewAnswers, answerKey)) lines.push({ sign: "−", text: `${answer.agent}'s review of ${stageLabel(answer.stage)}` });
  return lines;
}

/**
 * How a section of the project differs between two states, `then` being
 * the state gone to and `now` the one gone from: for the Agents module's,
 * the requests asked, withdrawn and fulfilled and the review findings that
 * differ, each with its module's name where `moduleName` gives one.
 */
export function sectionDifferenceLines(
  section: string,
  then: unknown,
  now: unknown,
  stageLabel: (stage: string) => string,
  moduleName: (moduleId: string) => string | null,
): SectionLine[] {
  if (section !== AGENTS_SECTION) return [{ sign: "~", text: `${section} changed` }];
  const [before, after] = [parseAgentsSection(now), parseAgentsSection(then)];
  const modules = [...new Set([...Object.keys(before.modules), ...Object.keys(after.modules)])];
  return modules.flatMap((moduleId) => {
    const name = moduleName(moduleId);
    return moduleLines(requestsOfModule(after, moduleId), requestsOfModule(before, moduleId), stageLabel).map((line) => (name == null ? line : { ...line, text: `${name}: ${line.text}` }));
  });
}
