# Using the workflow

Generate and review each stage in order. Approval is a deliberate gate at Boundary Design, the Implementation Profile, every interface bundle, every subject protocol/binding, and every verification contract.

## Boundary Design

Review what each subject owns and excludes, which peer uses each interface, and whether interactions describe observable behavior without implementation syntax. Confirm that internal subjects are justified and every acceptance criterion has behavioral or non-behavioral coverage. Simple semantic text can be edited while the graph is a draft. Use a graph-level change request for structural changes, then approve the complete graph.

## Interface Contracts

Review and approve the open-ended Implementation Profile first. For each interface, inspect the adapter identity, formal declarations, normalized operation/outcome schemas, native anchors, and hashes. Review each subject's shared lifecycle and harness binding. Formal artifacts are read-only; request a reconciled revision when they need changes. The reconciled draft includes an artifact diff and every changed bundle returns to draft status for explicit approval.

## Scenarios and cases

A behavioral scenario identifies one subject and approved interfaces owned by it. A verification scenario identifies one formal non-behavioral obligation. Generated cases show human-readable steps and expected results, but their source of truth is the structured trace or verification plan.

## Project Setup and tests

Project Setup selects deterministic build/test commands and creates a manifest-controlled scaffold. Approved native contracts are copied byte-for-byte. Product seams remain unimplemented. Automated Tests use exact case and contract revisions and write only to the scenario path declared by the manifest.

Project Files is a separate viewer. The Code stage remains pending because neither scaffold nor test generation implements the product.

## Stale work and recovery

When a revision would invalidate completed downstream artifacts, review the impact list. Confirming saves a complete recovery snapshot before applying the revision. Stale artifacts remain visible but cannot drive further generation. Open **Revisions** to pin, restore, download, or delete snapshots.

Imports must use the current project schema. Obsolete imports are rejected clearly; no compatibility migration is applied.
