# System overview

Requireganizer is a Next.js application with a MobX State Tree project model, server actions for model access, IndexedDB recovery/activity stores, and a VitePress documentation site.

## Main boundaries

| Boundary | Responsibility |
| --- | --- |
| Screens and components | Review and approve artifacts, show statuses and impact, initiate scoped actions. |
| Project store | Own schema-v2 artifacts, exact revision bindings, fingerprints, virtual files, import/export, and atomic state transitions. |
| Contract domain | Define boundary, formal-contract, structured-test, setup types and authoritative validation. |
| AI server actions | Build one scoped request with one result function plus `communicate`. |
| Harness runner | Dispatch one formal call, run one repair attempt, and return typed outcomes and metadata. |
| Browser databases | Partition provider calls and recovery snapshots per project. |

## Request path

```text
User action → prerequisite/approval check → stage server action
→ fixed policy + approved adapter instructions + changing request data
→ operation function + communicate → provider tool call
→ authoritative parse and semantic validation → typed proposal
→ application-owned IDs/revisions/hashes → atomic application or impact confirmation
```

## Source layout

```text
app/contract-domain/   revisioned artifact types, schema projection, validation, hashing
app/ai-harness/        prompts, formal tools, runner, transport contracts
app/actions/ai/        operation-specific server actions
app/store/             project model, status, client orchestration, import/export
app/lib/               browser persistence and safe filesystem utilities
docs/                  VitePress product and engineering contracts
tests/                 transport, domain, state, persistence, and rendering tests
```

## Design principles

- Approve semantic boundaries before formalizing implementation interfaces.
- Generate tests only from exact approved contract revisions.
- Treat provider schemas as transport hints and runtime validation as authoritative.
- Keep project behavior out of scaffold seams.
- Preserve stale work for inspection and block it from further generation.
- Snapshot before applying a revision with downstream impact.
- Keep the virtual project filesystem separate from the Code workflow stage.
