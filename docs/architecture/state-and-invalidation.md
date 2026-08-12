# State and invalidation

## Atomic proposal application

AI results are proposals, not commands. Client helpers clone the MobX State Tree store, apply the complete proposal to that clone, then replace the live snapshot. If ID materialization, dependency resolution, fragment construction, or another state invariant fails, the live project remains unchanged.

A complete-list proposal is reconciled in four steps:

1. Map every proposal-local key to its preserved ID or a newly generated UUID.
2. Resolve local dependency keys to those persisted IDs.
3. Reuse and update items whose existing IDs were explicitly preserved; construct only genuinely new items.
4. Rebuild the target order from complete snapshots and commit it through the outer atomic update.

This is complete-list semantics, not blind destructive replacement. Omitted existing items are removed, but preserved scenario IDs retain their nested test cases and metadata. Unchanged regenerated test cases retain modification timestamps, so they do not become spuriously out of sync.

A focused revision updates only its server-validated target. Test-code application updates one server-controlled virtual path and marks only the selected case as generated.

## Minimal stage context

The store builds cumulative context ending at the requested stage:

| Requested stage | Included upstream state |
| --- | --- |
| Product overview | Description. |
| User stories | Description and product overview. |
| Requirements | Previous fields and user stories. |
| Acceptance criteria | Previous fields and requirements. |
| Test scenarios | Previous fields and acceptance criteria. |
| Test cases | Previous fields and all scenarios; only the current scenario includes existing cases. |

Build artifacts and scaffold files are excluded from ordinary specification prompts. Project configuration uses the reviewed specification through test cases. Test-code generation uses a smaller explicit request for one scenario, one case, and one target file.

## Input fingerprints

After a stage is generated, the store serializes the exact upstream input used for that stage. Status calculation rebuilds the current input and compares it with the recorded fingerprint.

If they differ, the generated stage becomes **Outdated**. This propagates engineering change explicitly without deleting reviewer work.

Project configuration has a separate fingerprint covering the specification through test cases. If that input changes, configuration-dependent scaffold and test-code views are stale until configuration is regenerated and locked again.

The Test Cases stage is complete only when at least one scenario exists and every scenario has at least one case. One populated scenario cannot hide another empty scenario.

## Persistence

Project export includes:

- specification artifacts and traceability;
- project configuration and generated scaffold files when present;
- stage fingerprints;
- the project-configuration fingerprint.

Development-only AI error details and provider-call activity live in volatile UI state and are excluded from autosave and project export. Provider activity retains bounded timing, outcome, identity, and token metadata without prompts or successful model responses.

Imported project data and its project-index entry are written as one recoverable browser-storage transaction. If either write fails, both keys are restored to their prior values. Import validates persisted scaffold paths and restores valid fingerprints.

## Why fingerprints instead of timestamps

Fingerprints compare material input, so unrelated edits do not invalidate a stage merely because time passed. Fingerprints use deterministic JSON serialization of ordered store data.
