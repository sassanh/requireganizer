import type {
  BehavioralTraceEvent,
  PortableMatcher,
  TestCaseDefinition,
} from "./types";

function value(value: unknown): string {
  return JSON.stringify(value);
}

export function renderMatcher(matcher: PortableMatcher): string {
  switch (matcher.kind) {
    case "exact":
      return `exactly ${value(matcher.value)}`;
    case "schema":
      return "a value conforming to the declared outcome schema";
    case "presence":
      return `${matcher.pointer || "/"} is ${matcher.present ? "present" : "absent"}`;
    case "subset":
      return `a value containing ${value(matcher.value)}`;
    case "range":
      return `${matcher.pointer || "/"} is within ${matcher.minimum ?? "−∞"}…${matcher.maximum ?? "+∞"}`;
    case "regex":
      return `${matcher.pointer || "/"} matches /${matcher.pattern}/`;
    case "unordered_list":
      return `${matcher.pointer || "/"} contains ${value(matcher.items)} in any order`;
  }
}

function renderTraceEvent(event: BehavioralTraceEvent): string {
  const target = `${event.interfaceId}.${event.interactionId}`;
  const correlation = event.correlationAlias == null
    ? ""
    : ` [${event.correlationAlias}]`;
  switch (event.kind) {
    case "input":
      return `Send${correlation} ${value(event.payload)} to ${target}.`;
    case "output":
      return `Observe output${correlation} ${event.outcomeId} from ${target}: ${renderMatcher(event.matcher!)}.`;
    case "error":
      return `Observe error${correlation} ${event.outcomeId} from ${target}: ${renderMatcher(event.matcher!)}.`;
    case "event":
      return `Observe event${correlation} ${event.outcomeId} from ${target}: ${renderMatcher(event.matcher!)}.`;
    case "silence":
      return `Verify${correlation} ${target} remains silent for ${event.withinMs} ms.`;
  }
}

export function renderTestCaseSteps(definition: TestCaseDefinition): string {
  if (definition.kind === "verification") {
    return [
      ...definition.setup.map((item) => `Set up: ${item}`),
      ...definition.stimulus.map((item) => `Apply: ${item}`),
      ...definition.evidence.map((item) => `Collect: ${item}`),
    ]
      .map((item, index) => `${index + 1}. ${item}`)
      .join("\n");
  }
  return definition.trace
    .map((event, index) => `${index + 1}. ${renderTraceEvent(event)}`)
    .join("\n");
}

export function renderTestCaseExpectedResult(
  definition: TestCaseDefinition,
): string {
  if (definition.kind === "verification") {
    return definition.passMatchers.map(renderMatcher).join("; ");
  }
  return definition.trace
    .filter(
      (event) =>
        event.kind === "output" ||
        event.kind === "error" ||
        event.kind === "event" ||
        event.kind === "silence",
    )
    .map(renderTraceEvent)
    .join(" ");
}
