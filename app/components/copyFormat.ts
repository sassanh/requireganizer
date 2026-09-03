import {
  STRUCTURAL_FRAGMENT_LABEL,
  StructuralFragment as StructuralFragmentName,
} from "store";
import type {
  StructuralFragment,
  TestCase,
} from "store/models";

function headerLine(code: string, type: StructuralFragmentName, priority: string): string {
  const label = STRUCTURAL_FRAGMENT_LABEL[type] ?? type;
  return `${code} · ${label}${priority === "" ? "" : ` · ${priority.toUpperCase()}`}`;
}

function appendReferences(
  lines: string[],
  label: string,
  ids: readonly string[],
  getCode: (id: string) => string,
): void {
  if (ids.length === 0) return;
  lines.push(`${label}: ${ids.map((id) => getCode(id)).join(", ")}`);
}

/**
 * Render one structural fragment as nicely formatted plain text for the
 * clipboard. Each shape writes its own section; shared chrome (header,
 * references, dependencies) stays in one place.
 */
export function formatFragmentCopy(options: {
  code: string;
  fragment: StructuralFragment;
  getCode: (id: string) => string;
}): string {
  const { code, fragment, getCode } = options;
  const lines = [
    headerLine(code, fragment.type, fragment.priority ?? ""),
  ];
  if (fragment.type === StructuralFragmentName.TestCase) {
    const testCase = fragment as TestCase;
    lines.push(testCase.title);
    if (testCase.description !== "") lines.push(testCase.description);
    if (testCase.steps !== "") lines.push(`Steps:\n${testCase.steps}`);
    if (testCase.expectedResult !== "") {
      lines.push(`Expected result:\n${testCase.expectedResult}`);
    }
    appendReferences(
      lines,
      "References",
      testCase.references.map(({ id }) => id),
      getCode,
    );
  } else {
    lines.push(fragment.content);
    if (
      "description" in fragment &&
      typeof fragment.description === "string" &&
      fragment.description !== "" &&
      fragment.description !== fragment.content
    ) {
      lines.push(fragment.description);
    }
    appendReferences(
      lines,
      "References",
      fragment.references.map(({ id }) => id),
      getCode,
    );
  }
  appendReferences(lines, "Depends on", fragment.dependencies, getCode);
  return `${lines.join("\n\n")}\n`;
}

/** Render a bare labeled field (overview name/purpose) for the clipboard. */
export function formatFieldCopy(label: string, text: string): string {
  return `${label}\n${text}\n`;
}
