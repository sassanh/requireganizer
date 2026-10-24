# Using the workflow

Work happens at the frontier: the first stage that is not complete. Generate it, review every item, and approve; when the stage is complete, the next one becomes the frontier. Stages after the frontier are read-only until it reaches them. Generated work is draft.

Approval is the same gate everywhere: Product Overview items, stories, requirements, and criteria, then Boundary Design, the Implementation Profile, every interface bundle, every subject protocol and binding, every verification contract, scenarios, cases, and Project Setup.

## Reviewing a stage

Each item's left bar is its approval stamp: muted until approved, green when approved. Coverage holes and dangling IDs stay as text under the item, and so does a note on an item that is outdated. After a rewrite of an approved item, the row shows a standing word diff against the signed text; **Restore** brings the signed version back, with its approval when nothing it references has changed since. A proposed removal stays on the page, struck through, until Approve deletes it or Restore withdraws it. A stage line names kept, rewrote, added, and dropped when more than one row changed. Formal contracts show a semantic suite diff; whole-revision artifacts (boundary, profile, setup) are not prose rows.

In User Stories, Requirements, and Acceptance Criteria, the **Coverage** list under the items asks one approval per upstream item: the items referencing it cover it fully. Request a change there when something is missing.

## Review modes

Each stage runs in **Manual review** or **Auto review**. With a reviewer model configured (`AI_REVIEWER_MODEL` for a server, **AI settings** in the page build), the model judges every draft against the stage's quality contract. In manual review its verdict appears next to the item as a recommendation and you approve. In auto review its approval is the approval; a rejection waits for you with the model's reason. When you approve something the model rejected, or request a change to something it approved, you decide in a dialog that shows its reason. **Review with the model** asks for verdicts on drafts that have none.

## Changing an earlier stage

Requesting a change in a stage before the frontier reopens that stage. When later stages hold work, a dialog lists them first; confirming saves a recovery snapshot and applies the change.

When an item changes, every item that references it is outdated: refresh the stage to regenerate them. A regenerated item returns to draft even when the rewriter kept it word for word. Items that reference none of the changed inputs keep their approvals but need one **impact** approval: the change affects none of them. Send back any item it does affect; it becomes outdated until regenerated.

## Stage tabs

A lock is an empty stage after the frontier; it cannot be opened. An hourglass is a stage after the frontier that holds work, readable but waiting. A timer is the frontier while it is empty or misses coverage. A warning is the frontier while it holds outdated or unapproved work. A green check is a complete stage.

## Boundary Design

Review what each subject owns and excludes, which peer uses each interface, and whether interactions describe observable behavior without implementation syntax. Confirm that internal subjects are justified and every acceptance criterion has behavioral or non-behavioral coverage. Request a graph-level change when the graph needs one, then approve the complete graph.

## Interface Contracts

Review and approve the open-ended Implementation Profile first. For each interface, inspect the adapter identity, formal declarations, normalized operation/outcome schemas, native anchors, and hashes. Review each subject's shared lifecycle and harness binding. Formal artifacts are read-only; request a reconciled revision when they need changes. The reconciled draft includes an artifact diff, and every changed bundle returns to draft for explicit approval.

## Scenarios and cases

A behavioral scenario identifies one subject and approved interfaces owned by it. A verification scenario identifies one formal non-behavioral obligation. Generated cases show human-readable steps and expected results, but their source of truth is the structured trace or verification plan.

## Project Setup and tests

Project Setup selects deterministic build/test commands and creates a manifest-controlled scaffold. Approved native contracts are copied byte-for-byte. Product seams remain unimplemented. Automated Tests use exact case and contract revisions and write only to the scenario path declared by the manifest.

Project Files is a separate viewer. The Code stage remains pending because neither scaffold nor test generation implements the product.

## Recovery and imports

Open **Revisions** to pin, restore, download, or delete recovery snapshots.

Imports accept schema 4 (modular projects) or a single module snapshot of schema 5, or of schema 3, which is migrated on load. Any other version is rejected with the accepted versions named.
