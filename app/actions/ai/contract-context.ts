import "server-only";

import type {
  BoundaryDesign,
  ContractSuite,
  ImplementationProfile,
} from "contract-domain";
import {
  validateContractSuite,
  validateImplementationProfile,
} from "contract-domain";
import { isRecord } from "lib/json";

export function artifactIds(
  state: Record<string, unknown>,
  field: "requirements" | "acceptanceCriteria" | "testScenarios",
): string[] {
  const value = state[field];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    isRecord(item) && typeof item.id === "string" && item.id.length > 0
      ? [item.id]
      : [],
  );
}

export function assertApprovedContractContext(
  design: BoundaryDesign,
  suite: ContractSuite,
  profile?: ImplementationProfile,
): void {
  if (design.status !== "approved") {
    throw new Error("Boundary Design must be approved.");
  }
  if (profile != null) {
    if (profile.status !== "approved") {
      throw new Error("Implementation Profile must be approved.");
    }
    validateImplementationProfile(profile, design.revisionId);
  }
  validateContractSuite(
    suite,
    design,
    profile?.revisionId ?? suite.profileRevisionId,
  );
  if (
    suite.interfaceContracts.some(({ status }) => status !== "approved") ||
    suite.subjectContracts.some(({ status }) => status !== "approved") ||
    suite.verificationContracts.some(({ status }) => status !== "approved")
  ) {
    throw new Error("Every formal contract bundle must be approved.");
  }
}
