import { InvalidJsonError } from "lib/json";

export interface ProtectedTestBlock {
  id: string;
  content: string;
}

function annotationId(
  line: string,
  marker: "beginning" | "end",
): string | null {
  const normalized = line.trim().replace(/\s+-->\s*$/, "");
  const suffix = ` - ${marker}`;
  if (!normalized.endsWith(suffix)) return null;

  const beforeMarker = normalized.slice(0, -suffix.length);
  const separator = beforeMarker.lastIndexOf(" - ");
  if (separator < 0) return null;

  const id = beforeMarker.slice(separator + 3).trim();
  return id.length > 0 ? id : null;
}

export function collectProtectedTestBlocks(
  existingCode: string | undefined,
  currentTestCaseId: string,
): ProtectedTestBlock[] {
  if (existingCode == null) return [];

  const lines = existingCode.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) ?? [];
  const blocks: ProtectedTestBlock[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const id = annotationId(lines[index], "beginning");
    if (id == null || id === currentTestCaseId) continue;
    if (seen.has(id)) {
      throw new InvalidJsonError(
        `Existing test file contains duplicate beginning annotations for ${id}.`,
      );
    }

    let endIndex = index + 1;
    while (
      endIndex < lines.length &&
      annotationId(lines[endIndex], "end") !== id
    ) {
      endIndex += 1;
    }
    if (endIndex >= lines.length) {
      throw new InvalidJsonError(
        `Existing test file is missing the end annotation for ${id}.`,
      );
    }

    seen.add(id);
    blocks.push({ id, content: lines.slice(index, endIndex + 1).join("") });
    index = endIndex;
  }

  return blocks;
}

function occurrenceCount(source: string, value: string): number {
  if (value.length === 0) return 0;

  let count = 0;
  let position = 0;
  while ((position = source.indexOf(value, position)) >= 0) {
    count += 1;
    position += value.length;
  }
  return count;
}

export function assertValidGeneratedTestCode({
  code,
  scenarioAnnotation,
  beginAnnotation,
  endAnnotation,
  protectedBlocks,
}: {
  code: string;
  scenarioAnnotation: string;
  beginAnnotation: string;
  endAnnotation: string;
  protectedBlocks: ProtectedTestBlock[];
}): void {
  const firstLine = code.split(/\r\n|\n|\r/, 1)[0];
  if (firstLine !== scenarioAnnotation) {
    throw new InvalidJsonError(
      "Generated test code is missing its scenario annotation.",
    );
  }

  for (const annotation of [beginAnnotation, endAnnotation]) {
    if (occurrenceCount(code, annotation) !== 1) {
      throw new InvalidJsonError(
        "Generated test code must contain each current test annotation exactly once.",
      );
    }
  }

  for (const block of protectedBlocks) {
    if (occurrenceCount(code, block.content) !== 1) {
      throw new InvalidJsonError(
        `Generated test code did not preserve the existing block for ${block.id} byte-for-byte.`,
      );
    }
  }
}
