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
| Product Overview | Purpose, primary features, target users | The overview is complete, every item is approved, and it contains no implementation choice. Downstream generate waits until every item is approved. |
| User Stories | Independently valuable user outcomes | Every primary feature has traceable coverage, every story is approved, and every feature's coverage is approved. |
| Requirements | Atomic, solution-neutral obligations | Every story has traceable coverage, every requirement is approved, and every story's coverage is approved. |
| Acceptance Criteria | Observable pass/fail conditions | Every requirement has traceable coverage, every criterion is approved, and every requirement's coverage is approved. |
| Boundary Design | Revisioned subjects, semantic interfaces/interactions, verification obligations, complete criterion coverage | The complete graph validates and is explicitly approved. |
| Interface Contracts | Approved implementation profile; per-interface adapter, native/neutral contract and normalized index; per-subject protocol and harness binding; verification contracts | The profile and every formal bundle are explicitly approved. |
| Test Scenarios | Behavioral or verification scenarios bound to exact contract revisions | Every scenario has one valid revision binding. |
| Test Cases | Structured behavioral traces or verification plans | Every scenario has at least one valid structured case. |
| Project Setup | Build configuration, scaffold manifest, contract-bearing files and unimplemented binding seams | Contract hashes, paths, targets, and bindings validate. |
| Automated Tests | Executable tests generated into manifest-controlled targets | Every current structured case has a generated file fingerprint. |
| Code | Future application implementation | This stage remains pending. Scaffold and tests never complete it. |

Nobody types artifact prose; reviewers **Request change** or **Approve**. Generate and rewrite produce **draft**. Downstream generate consumes only a fully approved stage.

A change request opens a thread on its unit. The project names who answers threads: Requireganizer's writer or a connected coding agent. An answer changes the unit or only replies, and only a person resolves a thread.

Validators check IDs, allowed references, coverage of upstream IDs, and acyclic dependencies immediately in code. They do not parse sentence shape or ban words. Coverage holes remain standing after changes; they are not generate-time only.

## Progress

A project is **in progress** or **complete**, derived from its stages and never stored. A stage is complete when its completion rule holds and every approval it needs is given. The frontier is the first stage that is not complete; a project without one is complete. Code is outside this workflow and does not count toward completion; code work waits until the project is complete.

Only the frontier and the stages before it can change. Later stages are read-only: their work stays visible but cannot be edited, generated, or approved until the frontier reaches them. Changing an earlier stage, or any stage of a complete project, makes that stage the frontier. Before such a change applies, the application shows every later stage that holds work and requires confirmation.

Modules are the slices of a product; within a module, the frontier advances one stage at a time. Priority labels are not part of the method and never scope generation or coverage.

## Approval

An approval records what was checked, who checked it (a person, or the reviewer model by name), and when. What was checked is the item's full content (its text, structured definition, and references) together with the exact revisions of the items it references. An item is approved only while that record matches. Any change to either, however small, returns the item to draft. Approval is not part of any revision, so approving never outdates other work.

A stage's inputs are only the stages its items reference; earlier stages reach it through them. When an item changes, every item referencing it is outdated and must be regenerated before it can be approved again. The rewriter may keep an item word for word when the change does not affect it; the regenerated item returns to draft either way. An item kept unchanged keeps its revision, so the change reaches no further than the items that reference it.

A rewritten item that was approved before can be restored to its signed version, which discards the rewrite; restoring an item proposed for removal withdraws the removal. The restored item is approved again only if the revisions it references have not changed since it was signed; otherwise it is a draft, reviewed against the new inputs.

A change can also affect an item that does not reference the changed item. So when upstream revisions change, the stage's approved items that reference none of them need one impact approval: the change affects none of these items. It records the upstream changes and the items it covers. The reviewer approves it, or sends chosen items back to be regenerated, which returns them to draft.

Approving every item does not attest that nothing is missing. In User Stories, Requirements, and Acceptance Criteria, each upstream item also needs a coverage approval: the items referencing it cover it fully. A coverage approval records the upstream item and the complete set of items referencing it, so changing the upstream item, or adding, removing, or changing any item referencing it, returns it to draft.

Every reviewable stage, and every coverage and impact approval, has a quality contract. The writer checks its items against it before submitting. A reviewer model judges every draft against it, in a context separate from the model that wrote the items. The reviewer model is configured separately; without it there is no model verdict, and auto review is unavailable.

Each stage runs in **manual** or **auto** review, switchable at any time. In auto review the reviewer model's approval is the approval. In manual review its verdict is a recommendation shown with the item, and a person approves or requests changes. A rejection leaves the item in draft with the reviewer's reason until a person requests a change or restores the signed version; nothing is rewritten automatically. A person can approve or reject any item in either mode. When a person's verdict and the model's differ, the item stays unapproved until the person decides, shown both verdicts and the model's reason; the decision records both verdicts. Switching modes affects only future decisions; approvals already given stay, each recording who gave it.

## Boundary invariants

The root product subject is mandatory. An internal subject needs explicit requirement or criterion justification. Every interface belongs to one subject, and every interaction belongs to one interface. A behavioral scenario can use several interfaces only when they belong to its one subject. Cross-subject behavior requires an explicit composite subject.

Every acceptance criterion maps to either a semantic interaction or a typed non-behavioral verification obligation. The graph cannot be approved with missing or inconsistent coverage.

## Revision bindings

Every downstream artifact stores exact upstream revision IDs. A changed approved artifact produces a new revision; it never mutates an approved revision in place.
