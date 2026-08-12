# Prompt and tool contracts

The harness separates three concerns that must not be conflated:

1. the system prompt defines stable policy, workflow, role, and trust boundaries;
2. the user payload supplies task-specific context and semantic quality rules;
3. formal function definitions supply the machine-readable argument schema.

The API communicates function signatures through `tools`, and the harness reads the selected call from `message.tool_calls`.

## Data is not instruction

Project descriptions, configuration, scenarios, test cases, existing artifacts, existing files, user feedback, prior tool calls, and validation errors are serialized inside named fields. The system policy labels them as untrusted data that must never override its instructions.

This does not make model behavior inherently trustworthy. JSON Schema improves compliance, while runtime validation remains the authority for what can enter application state.

## Operation matrix

| Operation | Input scope | Formal result tool | Values excluded from model control |
| --- | --- | --- | --- |
| Product overview | Description and supported framework-language pairs. | `submit_product_overview` | Operation identity. |
| Artifact stage | State through that stage and optional parent scenario. | `submit_<entity>_list` | Entity type and parent ID; the client store assigns new persisted IDs after validation. |
| Focused revision | Target ID/type, feedback, and state through the target stage. | `submit_fragment_revision` | Target type and ID. |
| Project configuration | Reviewed specification through test cases. | `submit_project_configuration` | Operation identity. |
| Scaffold | Reviewed specification and parsed project configuration. | `submit_project_scaffold` | Operation identity and virtual-filesystem boundary. |
| Test code | Small project summary, parsed config, one scenario, one case, and its exact existing file. | `submit_test_code` | Target file path. |

Every request also supplies `communicate`. It has one `message` argument and is valid only when essential input is missing, contradictory, or unsafe to infer.

## Prompt quality rules

The canonical workflow definition owns stage order, role, prerequisites, reference types, coverage type, objective, item contract, and quality constraints.

Prompt serialization keeps reusable policy, workflow, task contracts, and quality rules ahead of assignment-specific values and project data. Tool schemas likewise place stable constraints before request-specific identifier enums. Providers with automatic prefix caching can therefore reuse the longest safe prefix without weakening validation.

Examples:

- user stories use a specific user, testable outcome, and objective value;
- requirements contain one solution-neutral, verifiable obligation;
- acceptance criteria describe binary observable outcomes;
- scenarios remain high-level and cover normal, boundary, and failure situations;
- test cases remain within one parent scenario and contain reproducible steps.

## Identity and dependency rules

The model never creates persisted IDs. Every complete-list item instead has a unique proposal-local `key`.

- A genuinely new item omits `id`; after server validation, the client store creates its UUID during atomic application.
- An existing item includes `id` only when it preserves the same intent. The function schema constrains that field to exact IDs in the current target list.
- Dependencies contain proposal-local keys, so new items can depend on each other without inventing future UUIDs.
- The server resolves all dependency keys to persisted IDs in one pass after the complete result validates.
- References still use exact existing upstream IDs and types from project context.

## Repair behavior

A schema-shaped function call can still violate semantic constraints. The single repair attempt receives the concrete validator error, the previous call, and the original task. It is sent with the same task-specific result tool and `communicate` tool and must make exactly one new formal call.

If repair also fails, the runner returns `status: "error"`, leaves project state unchanged, and makes both rejected provider responses available through the development-only **More details** dialog.

## Adding an operation

1. Define request and proposal types in `app/ai-harness/contracts.ts`.
2. Add the semantic task contract in `app/ai-harness/prompts.ts`.
3. Add a closed formal function definition in `app/ai-harness/tools.ts`.
4. Add a strict runtime parser in `app/ai-harness/validation.ts`.
5. Add a server action that calls `runStructuredHarnessTask` with the result tool and parser.
6. Add a client orchestration action with explicit prerequisites and atomic application.
7. Add request-capture, valid-call, repair, and adversarial semantic tests.
8. Update protocol and prompt versions when compatibility changes.
9. Update this documentation when workflow, transport, or trust boundaries change.
