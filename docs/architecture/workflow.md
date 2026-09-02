# Engineering workflow

Requireganizer uses this contract-first order. A new project may optionally supply starting intent once to draft the Product Overview; that text is not a stage. It is kept as revision 0 provenance so the overview can always be audited back to its seed.

```text
Product Overview → User Stories → Requirements
→ Acceptance Criteria → Boundary Design → Interface Contracts
→ Test Scenarios → Test Cases → Project Setup → Automated Tests → Code
```

## Stage contracts

| Stage | Delivered artifact | Completion rule |
| --- | --- | --- |
| Product Overview | Product name, purpose, primary features, target users | The overview is complete, every item is approved, and it contains no implementation choice. Downstream generate waits until every item is approved. |
| User Stories | Independently valuable user outcomes | Every primary feature has traceable coverage and every story is approved. |
| Requirements | Atomic, solution-neutral obligations | Every story has traceable coverage and every requirement is approved. |
| Acceptance Criteria | Observable pass/fail conditions | Every requirement has traceable coverage and every criterion is approved. |
| Boundary Design | Revisioned subjects, semantic interfaces/interactions, verification obligations, complete criterion coverage | The complete graph validates and is explicitly approved. |
| Interface Contracts | Approved implementation profile; per-interface adapter, native/neutral contract and normalized index; per-subject protocol and harness binding; verification contracts | The profile and every formal bundle are explicitly approved. |
| Test Scenarios | Behavioral or verification scenarios bound to exact contract revisions | Every scenario has one valid revision binding. |
| Test Cases | Structured behavioral traces or verification plans | Every scenario has at least one valid structured case. |
| Project Setup | Build configuration, scaffold manifest, contract-bearing files and unimplemented binding seams | Contract hashes, paths, targets, and bindings validate. |
| Automated Tests | Executable tests generated into manifest-controlled targets | Every current structured case has a generated file fingerprint. |
| Code | Future application implementation | This stage remains pending. Scaffold and tests never complete it. |

Work moves in small complete iterations. An iteration may cover a whole stage or one fully worked slice of it; what matters is that everything it claims is finished and approved. One undecided item blocks its set — it waits for a later iteration instead of flowing downstream half-done. The person running the workspace chooses each iteration's scope: high-risk first, low-risk first, anything. The method is unopinionated about order. Priority labels are not part of the method and never scope generation or coverage.

Writing quality for Product Overview, User Stories, Requirements, and Acceptance Criteria is judged by a reviewer separate from the helper that wrote the prose — nothing grades its own writing — against each stage's quality contract on the submit tool. Humans do not type artifact prose; they **Request change** or **Approve**. Generate and rewrite produce **draft**. The left bar is that stamp: muted until signed, green when approved. Coverage holes and dangling IDs stay as text under the item. After a rewrite of signed prose, the row shows a standing word-diff against the last signed text until it is approved again. A proposed removal stays on the page, struck through, until Approve deletes it. A stage line names kept / rewrote / added / dropped when more than one row changed. Formal contracts already show a semantic suite diff; whole-revision artifacts (boundary, profile, setup) are not prose rows. Tab lock is a later empty stage while an earlier stage is not completed (empty, unsigned, or stale); navigation and generate cannot open it. Tab timer is empty or missing coverage. Tab yellow is unsigned work or a stale upstream fingerprint. Tab green is mechanically complete and fully approved. Downstream generate consumes only a fully approved stage.

Validators check IDs, allowed references, coverage of upstream IDs, and acyclic dependencies immediately in code. They do not parse sentence shape or ban words. Coverage holes remain standing after changes; they are not generate-time only. Approval does not move fingerprints. An edit that leaves an item byte-identical to its last approved content stays approved automatically; any real change, however small, produces a new revision and returns the item to draft.

## Boundary invariants

The root product subject is mandatory. An internal subject needs explicit requirement or criterion justification. Every interface belongs to one subject, and every interaction belongs to one interface. A behavioral scenario can use several interfaces only when they belong to its one subject. Cross-subject behavior requires an explicit composite subject.

Every acceptance criterion maps to either a semantic interaction or a typed non-behavioral verification obligation. The graph cannot be approved with missing or inconsistent coverage.

## Design scope

The current design view — subjects, interfaces, test obligations — is the first version, not the whole of design. A domain model, operational deployment, threats, stored data, and day-to-day operation are recorded future debt and explicitly out of the first version. Platform and runtime names on the Implementation Profile are covered; hosting, environments, and topology are not.

## Revision bindings

Every downstream artifact stores exact upstream revision IDs. A changed approved artifact produces a new revision; it never mutates an approved revision in place. Before a change that affects completed downstream work is applied, the application shows the dependency closure and requires confirmation. The current project is saved to IndexedDB first, and affected artifacts remain viewable but stale.

The latest 20 unpinned snapshots per project are retained. Pinned snapshots are not pruned. A restore operation snapshots the current state before loading the selected revision.
