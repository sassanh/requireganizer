import type { ApprovalStatus, RevisionMetadata } from "contract-domain";

export function isApproved(status: ApprovalStatus | null | undefined): boolean {
  return status === "approved";
}

export function assertApproved<T extends { status: ApprovalStatus }>(
  artifact: T | null | undefined,
  label: string,
): asserts artifact is T & { status: "approved" } {
  if (artifact == null || artifact.status !== "approved") {
    throw new Error(`An approved ${label} is required.`);
  }
}

export function asDraftRevision<T extends RevisionMetadata>(artifact: T): T {
  if (artifact.status === "draft" && artifact.approvedAt == null) return artifact;
  const next = { ...artifact, status: "draft" as const };
  delete (next as { approvedAt?: string }).approvedAt;
  return next;
}

export function asApprovedRevision<T extends RevisionMetadata>(
  artifact: T,
  at = new Date().toISOString(),
): T {
  if (artifact.status === "approved") return artifact;
  return { ...artifact, status: "approved", approvedAt: at };
}
