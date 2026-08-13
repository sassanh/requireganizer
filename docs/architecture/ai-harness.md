# AI harness

The AI harness is an OpenAI-compatible function-calling boundary. Every request supplies exactly two formal tools: one operation-specific result function and `communicate`. The provider must call exactly one tool; ordinary assistant text and parallel calls are rejected.

## Request lifecycle

1. The client verifies completion and approval prerequisites.
2. The server builds a stable system policy, approved adapter instructions, and changing project/request data in that order.
3. The provider receives formal function definitions with required tool choice and parallel calls disabled.
4. The harness parses `message.tool_calls`, accepts exactly one supported function, and validates its arguments independently.
5. One failed validation receives one repair turn through the same tools.
6. A valid proposal is materialized with application-owned IDs, revisions, and content hashes, then applied atomically.

Provider schema acceptance is not a correctness signal. Runtime validation is authoritative.

## Adapter and schema safety

Each approved interface owns a persisted adapter program. Its exact revision is reused for scenario, case, setup, and automated-test generation. Adapter schemas must be self-contained, use local references only, remain within size/depth/count limits, use allowlisted keywords, and avoid resource-unsafe regular expressions.

`@cfworker/json-schema` performs authoritative runtime instance validation without generated code or `eval`. A conservative projection of the authoritative schema is used in provider-facing function definitions. The provider-facing projection never replaces runtime validation.

## Formal consistency

Interface bundles contain an adapter identity/version, native declarations or a neutral typed manifest, a normalized index of stable interaction/outcome IDs, and content hashes for native documents. Validation checks semantic interaction coverage, unique operations/outcomes, native anchors, schema safety, document paths and hashes. Subject bundles bind every owned interaction and interface revision. Project Setup places approved documents byte-for-byte and verifies their hashes.

## Behavioral traces

Behavioral cases declare one subject, one initial fixture, and an ordered asynchronous trace. Every input defines a unique correlation alias; its outputs, errors, and bounded-silence observations reference that alias. Inputs validate against normalized input schemas, including when a later input contains a capture reference. Outputs and errors identify declared outcomes and use portable matchers. Captures use JSON Pointer and can be referenced only by later inputs. Silence observations have a bounded timeout. Parallel branches and race assertions are outside the initial contract.

## Metadata and diagnostics

Every provider attempt records prompt/protocol versions, timing, outcome, model, selected tool, provider identifiers, normalized token usage, adapter IDs, interface-contract revisions, and subject-contract revisions. Logs are partitioned per project in IndexedDB and can be deleted or exported as JSON or CSV.

Development builds expose rejected raw responses behind **More details**. Production results omit that payload. A timeout has no model response to show.
