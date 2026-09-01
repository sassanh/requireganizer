# Engineering workflow

Requireganizer uses this contract-first order. A new project may optionally supply starting intent once to draft the Product Overview; that text is not a stage and is not stored.

```text
Product Overview → User Stories → Requirements
→ Acceptance Criteria → Boundary Design → Interface Contracts
→ Test Scenarios → Test Cases → Project Setup → Automated Tests → Code
```

## Stage contracts

| Stage | Delivered artifact | Completion rule |
| --- | --- | --- |
| Product Overview | Product name, purpose, primary features, target users | The overview is complete and contains no implementation choice. |
| User Stories | Independently valuable user outcomes | Every primary feature has traceable coverage. |
| Requirements | Atomic, solution-neutral obligations | Every story has traceable coverage. |
| Acceptance Criteria | Observable pass/fail conditions | Every requirement has traceable coverage. |
| Boundary Design | Revisioned subjects, semantic interfaces/interactions, verification obligations, complete criterion coverage | The complete graph validates and is explicitly approved. |
| Interface Contracts | Approved implementation profile; per-interface adapter, native/neutral contract and normalized index; per-subject protocol and harness binding; verification contracts | The profile and every formal bundle are explicitly approved. |
| Test Scenarios | Behavioral or verification scenarios bound to exact contract revisions | Every scenario has one valid revision binding. |
| Test Cases | Structured behavioral traces or verification plans | Every scenario has at least one valid structured case. |
| Project Setup | Build configuration, scaffold manifest, contract-bearing files and unimplemented binding seams | Contract hashes, paths, targets, and bindings validate. |
| Automated Tests | Executable tests generated into manifest-controlled targets | Every current structured case has a generated file fingerprint. |
| Code | Future application implementation | This stage remains pending. Scaffold and tests never complete it. |

Writing quality for Product Overview, User Stories, Requirements, and Acceptance Criteria is the agent's job against each stage's quality contract (stated on the submit tool). Validators check IDs, allowed references, coverage of upstream IDs, and acyclic dependencies. They do not parse sentence shape or ban words.

## Boundary invariants

The root product subject is mandatory. An internal subject needs explicit requirement or criterion justification. Every interface belongs to one subject, and every interaction belongs to one interface. A behavioral scenario can use several interfaces only when they belong to its one subject. Cross-subject behavior requires an explicit composite subject.

Every acceptance criterion maps to either a semantic interaction or a typed non-behavioral verification obligation. The graph cannot be approved with missing or inconsistent coverage.

## Revision bindings

Every downstream artifact stores exact upstream revision IDs. A changed approved artifact produces a new revision; it never mutates an approved revision in place. Before a change that affects completed downstream work is applied, the application shows the dependency closure and requires confirmation. The current project is saved to IndexedDB first, and affected artifacts remain viewable but stale.

The latest 20 unpinned snapshots per project are retained. Pinned snapshots are not pruned. A restore operation snapshots the current state before loading the selected revision.
