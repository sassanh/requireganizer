# Testing and quality

## Full local gate

```bash
pnpm run check
```

The command runs, in order:

1. ESLint across the repository.
2. Strict TypeScript checking without emission.
3. The compiled Node test suite.
4. A production Next.js build.
5. A production VitePress build, including link validation.

The same command runs for pull requests and pushes to `main`.

## Focused commands

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run docs:build
```

The test runner deletes `.test-dist` before every compilation and discovers only files produced by that compilation, keeping stale JavaScript out of the test run.

## Harness test strategy

Harness coverage spans the actual transport boundary, the runner, semantic validators, and application helpers.

Transport and runner tests verify:

- the outgoing request contains formal `tools`;
- `tool_choice` is `required` and parallel calls are disabled;
- results are read from `message.tool_calls`;
- OpenAI SDK connection timeouts are classified as transient;
- exactly one task tool or `communicate` call is accepted;
- the repair attempt uses the same formal tools;
- reusable prompt and schema content precedes request-specific data;
- provider usage fields normalize into input, cached-input, cache-write, output, and total token metadata;
- public errors stay concise while raw responses exist only in development details.

Contract and state tests verify:

- framework-language compatibility;
- server-owned stage, target, parent, and test-path identity;
- rejection of fabricated persisted IDs;
- proposal-local keys and dependency resolution;
- required upstream coverage and typed references;
- dependency cycles and cross-scenario references;
- scaffold response bounds and safe paths;
- byte-for-byte preservation of unrelated generated test blocks;
- preservation of nested cases and unchanged generation timestamps;
- recoverable imported-project storage writes;
- canonical stage order and symmetric capability maps.

When adding a validator, include at least one accepted example and a failure that exercises the semantic boundary—not only a missing property.

## Real-provider verification

Unit tests prove request construction and local behavior; they cannot prove that the configured gateway and selected model implement the claimed compatibility. Before treating a provider-facing bug as resolved:

1. run the actual development server with the intended endpoint and model;
2. reproduce the reporter's original project and workflow;
3. inspect **More details** if a tool call is rejected;
4. ask the reporter to repeat the failing operation;
5. do not call the bug fixed or commit the repair until the reporter confirms the observed workflow.

## Manual review checklist

Before merging a harness change:

- inspect the exact captured API request;
- confirm the formal function schema defines the complete argument shape;
- confirm the server parser owns every claimed invariant;
- confirm application-controlled fields are absent from model arguments;
- confirm the client sends only required context;
- verify failed application cannot mutate live state;
- check imported projects and existing generated test files;
- update prompt/protocol versions when compatibility changes;
- update architecture documentation and CI paths.
