# State, revisions, and invalidation

Project data uses schema version 4: a registry of modules, each holding a schema 5 module snapshot.

## The review gate

Every reviewable unit's state is derived in one place in the store.

- A unit's **revision** is a content hash for prose items and overview fields, and the stored revision ID for scenarios, cases, and formal artifacts. Scenarios and cases mint a new revision ID exactly when their content changes.
- Each generated item records its **basis**: the revision of every unit it references, plus the contract bundles a scenario binds. An item is **outdated** while its basis differs from the current revisions; a basis of null is unknown and always outdated. Formal artifacts are outdated when the upstream revisions they record are no longer current.
- An **approval record** holds the checked hash, the signed content, the reviewer, and the time. A unit is approved only while the record's checked hash equals the current one, the unit is not outdated, and it is not proposed for removal.
- The reviewer model's **verdict** is recorded against the checked hash it was given on and is current under the same rule.

Each list stage records the content of the inputs it last **acknowledged**: at a generation from empty, at an impact approval, and once nothing in the stage still answers a change. Inputs whose content differs are the stage's changed inputs. Approved items that reference none of them and were approved before the change form the impact unit.

The frontier, stage status, editability, and every gate on generation, approval, refresh, and change requests follow from these units.

## Exact dependencies

Boundary Design, Implementation Profile, interface bundles, subject bundles, verification contracts, scenarios, cases, and Project Setup have stable artifact IDs and immutable revision IDs. Boundary Design records the revisions of the requirement and acceptance-criteria sets it consumes. The Implementation Profile records its Boundary Design revision, and every later artifact stores the exact revisions it consumes.

Comment-driven formal-contract changes produce a complete draft and a semantic diff that excludes revision bookkeeping. Changed formal bundles require approval before they can be consumed.

Automated-test freshness uses a fingerprint of the structured case definition. Editing or regenerating an individual test file does not make Project Setup stale. Project Setup becomes stale only when its bound boundary/profile/contract revisions or structured test design change.

Code always remains pending.

## Import validation

Every stored or imported module passes one import gate. A schema 3 module is migrated there: approvals of work schema 3 showed current carry over as person approvals, work it showed outdated keeps an unknown basis and stays outdated until regenerated, and a draft's last signed text becomes its signed version. Persisted undo histories of another timeline version start fresh. Imports with any other version are rejected.

The gate checks every artifact's structure. A current artifact is also validated against the upstream it binds; a stale one is checked against itself, since its upstream has moved on, and stays readable until it is regenerated.

## Impact confirmation

A change that moves the frontier back is held until the user confirms the later stages that hold work. Confirmation first saves the complete current project to IndexedDB, then applies the change atomically. Work in later stages remains available for inspection, read-only until the frontier reaches it.

## Recovery storage

Snapshots are partitioned by project. The browser retains the newest 20 unpinned snapshots and every pinned snapshot. Users can pin, restore, download, or delete each snapshot. Restore first snapshots the current state.

Provider-call logs use separate per-project IndexedDB rows and are not embedded in project exports or snapshots.
