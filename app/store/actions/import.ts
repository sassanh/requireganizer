import { applySnapshot, getSnapshot, getType } from "mobx-state-tree";

import { InvalidJsonError, isRecord } from "lib/json";
import { parseScaffoldFiles } from "lib/scaffold";
import type { Store } from "store";
import { Step } from "store/constants";
import { isEnumMember } from "utilities";

function optionalArray(
  value: unknown,
  label: string,
): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new InvalidJsonError(`${label} must be an array.`);
  }
  return value;
}

function normalizeProjectConfig(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (isRecord(value)) return JSON.stringify(value, null, 2);
  throw new InvalidJsonError(
    "Project configuration must be a string or JSON object.",
  );
}

function normalizeStageInputFingerprints(
  value: unknown,
): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new InvalidJsonError("Stage input fingerprints must be an object.");
  }
  return Object.fromEntries(
    Object.entries(value).map(([step, fingerprint]) => {
      if (!isEnumMember(step, Step) || typeof fingerprint !== "string") {
        throw new InvalidJsonError(
          "Stage input fingerprints contain an invalid entry.",
        );
      }
      return [step, fingerprint];
    }),
  );
}

function optionalFingerprint(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new InvalidJsonError(
      "Project configuration input fingerprint must be text.",
    );
  }
  return value;
}

const importProject = (self_: unknown, value: unknown): void => {
  const self = self_ as Store;
  if (!isRecord(value)) {
    throw new InvalidJsonError("Imported project must be a JSON object.");
  }

  const description = value.description ?? "";
  if (typeof description !== "string") {
    throw new InvalidJsonError("Project description must be text.");
  }

  const productOverview = value.productOverview ?? {};
  if (!isRecord(productOverview)) {
    throw new InvalidJsonError("Product overview must be a JSON object.");
  }

  const scaffoldFiles = parseScaffoldFiles(value.scaffoldFiles ?? []);
  const projectConfig = normalizeProjectConfig(value.projectConfig);
  const candidateSnapshot = {
    ...getSnapshot(self),
    isClean: false,
    businessCounter: 0,
    description,
    validationErrors: null,
    systemMessage: null,
    productOverview,
    userStories: optionalArray(value.userStories, "User stories"),
    requirements: optionalArray(value.requirements, "Requirements"),
    acceptanceCriteria: optionalArray(
      value.acceptanceCriteria,
      "Acceptance criteria",
    ),
    testScenarios: optionalArray(value.testScenarios, "Test scenarios"),
    projectConfig,
    projectConfigLocked:
      projectConfig !== null && scaffoldFiles.length > 0,
    projectConfigInputFingerprint: optionalFingerprint(
      value.projectConfigInputFingerprint,
    ),
    isProjectConfigDialogOpen: false,
    scaffoldFiles,
    stageInputFingerprints: normalizeStageInputFingerprints(
      value.stageInputFingerprints,
    ),
  };

  // Construct a detached candidate first so a malformed import can never
  // partially mutate the active project.
  const candidateStore = getType(self).create(candidateSnapshot);
  applySnapshot(self, getSnapshot(candidateStore));
};

export default importProject;
