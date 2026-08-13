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
5. A Cloudflare/OpenNext worker build.
6. A production VitePress build, including link validation.

The same command runs for pull requests and pushes to `main`.

## Focused commands

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run cf:build
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

- subject containment, ownership, criterion coverage, and cross-subject restrictions;
- adapter keyword, reference, size, depth, and resource-safety limits;
- native documents, normalized indexes, mappings, and content hashes;
- exact interface, subject-protocol, and verification revision bindings;
- input/output, captured-value, event, failure, and bounded-silence traces;
- portable matchers and structured verification plans;
- manifest-controlled test paths and subject bindings;
- rejection of fabricated persisted IDs;
- proposal-local keys and dependency resolution;
- required upstream coverage and typed references;
- dependency cycles and cross-scenario references;
- scaffold response bounds, safe paths, and byte-for-byte contract placement;
- byte-for-byte preservation of unrelated generated test blocks;
- independent automated-test fingerprints;
- current-schema import rejection and recoverable storage writes;
- canonical contract-first stage order.

When adding a validator, include at least one accepted example and a failure that exercises the semantic boundary—not only a missing property.

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
