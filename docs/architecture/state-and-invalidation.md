# State, revisions, and invalidation

Project data uses schema version 2. Imports with another version are rejected; the application does not reinterpret legacy data.

## Exact dependencies

Boundary Design, Implementation Profile, interface bundles, subject bundles, verification contracts, scenarios, cases, and Project Setup have stable artifact IDs and immutable revision IDs. Boundary Design records the exact requirements and acceptance-criteria set revisions it consumes. The Implementation Profile records its Boundary Design revision, and every later artifact stores the exact approved revisions it consumes.

Comment-driven formal-contract changes produce a complete draft and a semantic diff that excludes revision bookkeeping. Changed formal bundles require approval before they can be consumed.

Automated-test freshness uses a fingerprint of the structured case definition. Editing or regenerating an individual test file does not make Project Setup stale. Project Setup becomes stale only when its bound boundary/profile/contract revisions or structured test design change.

Code always remains pending.

## Impact confirmation

An upstream revision computes the completed downstream dependency closure. If the closure is non-empty, the proposed change is held until the user confirms the affected artifacts and reasons. Confirmation first saves the complete current project to IndexedDB, then applies the new revision atomically. Existing downstream artifacts remain available for inspection with stale status and cannot be used as generation input.

## Recovery storage

Snapshots are partitioned by project. The browser retains the newest 20 unpinned snapshots and every pinned snapshot. Users can pin, restore, download, or delete each snapshot. Restore first snapshots the current state.

Provider-call logs use separate per-project IndexedDB rows and are not embedded in project exports or snapshots.
