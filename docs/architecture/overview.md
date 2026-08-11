# System overview

Requireganizer is a Next.js client application with a MobX State Tree project model and server actions for model access. VitePress hosts the engineering documentation separately.

## Main boundaries

| Boundary | Responsibility |
| --- | --- |
| Screens and components | Collect user intent, display artifacts and statuses, initiate store actions, and show concise failures. |
| Store actions | Enforce stage prerequisites, build minimal context, invoke server actions, and apply validated proposals atomically. |
| AI server actions | Select one operation, construct its prompts and result tool, and attach operation-specific validation. |
| Tool transport | Send OpenAI-compatible `tools`, require one call, and read `message.tool_calls`. |
| Harness runner | Dispatch the selected call, attempt one contract repair, and return a typed result with version metadata. |
| Validators | Reject invalid shape, scope, identity, references, dependencies, compatibility, paths, annotations, and output size. |
| Project store | Own artifacts, traceability, build files, generation fingerprints, import/export, and UI status. |

## Request path

```text
User action
  -> stage-specific store action
  -> minimal project context
  -> stage-specific server action
  -> system policy + task payload + operation-specific function schema
  -> OpenAI-compatible request with tools and tool_choice: required
  -> choices[0].message.tool_calls
  -> selected function arguments
  -> operation validator
  -> typed proposal | needs_input | error
  -> clone store -> apply complete proposal -> commit snapshot
```

Each request exposes one operation-specific submit function plus `communicate`. The server controls stage identity, focused-revision identity, and test-code paths; the client store assigns new persisted UUIDs after server validation succeeds.

## Source layout

```text
app/ai-harness/
  capabilities.ts    language-specific generation capabilities
  contracts.ts       TypeScript proposal and request types
  prompts.ts         shared policy and semantic task payloads
  reconciliation.ts  local-key to persisted-ID materialization
  runner.ts           tool dispatch, repair, and typed failure results
  test-code.ts        exact annotated-block preservation checks
  tools.ts            formal operation-specific function definitions
  validation.ts       runtime parsers and semantic validators
  workflow.ts         canonical stage definitions and quality rules

app/actions/lib/
  ai.ts               provider client, formal request construction, retry, timeout
  harness.ts          server-only adapter for the framework-neutral runner

app/actions/ai/       server actions for individual AI operations
app/store/actions/    client orchestration and atomic proposal application
docs/                 this VitePress site
tests/                transport, runner, contract, state, storage, and parser tests
```

## Design principles

- Treat function arguments and project content as untrusted input.
- Give each request one task and one write scope.
- Keep semantic instructions in prompts and machine shape in function schemas.
- Validate engineering relationships, not only JSON syntax.
- Preserve existing identifiers only when artifact intent is preserved.
- Use proposal-local keys for new-item dependencies; create persisted IDs during atomic client application.
- Make stale downstream work visible.
- Apply proposals atomically so failures leave live state unchanged.
- Expose provider diagnostics only in development.
