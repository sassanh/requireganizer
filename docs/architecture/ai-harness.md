# AI harness

The AI harness is the validation boundary inside a continuous pi-agent conversation. The conversation has one system prompt describing the whole workflow; each user action sends a short structured command (for example `{"kind":"generate","stage":"requirements"}`), and all artifact content reaches the model through tools.

## Turn lifecycle

1. The client verifies completion and revision prerequisites for the command.
2. The agent loop runs server-proxied streaming turns: read tools (`get_workflow_state`, `get_stage_artifacts`, `get_scaffold_files`) let the model inspect live project state, and `communicate` lets it ask one concise question.
3. For the commanded stage, exactly one result tool (`submit_*`) is offered alongside the reads. Its arguments carry the complete proposal.
4. The harness validates the submitted proposal independently of schema acceptance — parsers and contract-domain validators are authoritative.
5. A failed validation returns to the model as an error tool result so it can repair and resubmit within the same turn; there is no separate repair request.
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
