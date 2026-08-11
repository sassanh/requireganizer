# AI harness

The harness is a formal function-calling boundary around an OpenAI-compatible chat-completions model. Prompts define engineering intent; function-tool schemas define the transport shape; runtime validators remain authoritative for semantic correctness.

## Lifecycle

1. A client store action verifies the workflow prerequisites and clears any previous error.
2. A stage-specific server action builds a system policy, a task payload, and one operation-specific submit tool.
3. The shared runner adds the `communicate` tool and sends both as formal API `tools`.
4. The provider selects a function through `choices[0].message.tool_calls`.
5. Exactly one call is accepted. `communicate` produces a `needs_input` result; the operation-specific call proceeds to validation.
6. The runner parses the selected function's `arguments` as a JSON object and applies the operation's runtime shape and semantic validators.
7. If validation fails, one repair request receives the concrete validator error, prior tool call, and original task. The repair request uses the same formal tools.
8. A valid proposal returns with protocol metadata. The client applies it to a cloned store and commits the resulting snapshot only if the complete update succeeds.

Transport failures have a separate bounded retry policy. Connection failures, timeouts, rate limits, selected conflict/request-timeout statuses, and server errors receive up to three attempts with exponential backoff. OpenAI SDK retries are disabled so the application owns one explicit retry policy.

## Function-tool transport

Each request contains these transport controls:

```json
{
  "tools": [
    { "type": "function", "function": { "name": "submit_..." } },
    { "type": "function", "function": { "name": "communicate" } }
  ],
  "tool_choice": "required",
  "parallel_tool_calls": false
}
```

The complete function definitions include JSON Schema parameters, required fields, enums, descriptions, and `additionalProperties: false` where the contract is closed.

This follows the [OpenAI function-calling transport](https://developers.openai.com/api/docs/guides/function-calling): function schemas are sent as tools, calls are read from `message.tool_calls`, `tool_choice: "required"` requires a call, and disabling parallel calls bounds the turn to one. Function definitions use Chat Completions' non-strict mode to support the default gateway and contracts with optional or free-form fields. Runtime parsing and the repair turn therefore remain mandatory.

The server owns operation scope. An artifact-list tool accepts `items` while the server supplies the stage's `entityType`; a focused-revision tool accepts `patch` while the server supplies the target ID; and a test-code tool accepts `code` while the server supplies the target path.

## Validation layers

| Layer | Examples |
| --- | --- |
| Transport | Timeout and transient retry; formal `tools`; exactly one supported function call. |
| Arguments | Function arguments are one JSON object with only supported fields. |
| Scope | Server-controlled stage, parent, artifact type, artifact ID, and file path. |
| Identity | Existing IDs are constrained to the current target; new items use proposal-local keys and receive application-generated UUIDs during atomic client application. |
| Traceability | Existing typed references, complete upstream coverage, and exact scenario parent. |
| Graph | Known proposal-local dependency keys, no duplicates, self-links, or cycles. |
| Capability | Supported framework-language pair and an explicit test suffix for every language. |
| Files | Safe relative POSIX paths, unique scaffold paths, bounded file counts and response sizes. |
| Test preservation | Exact scenario marker, one current begin/end pair, and every unrelated annotated test block preserved byte-for-byte. |

Runtime validation is the correctness boundary. It verifies function arguments independently of provider-side schema handling.

## Failure and diagnostic behavior

The runner returns a discriminated result for all expected outcomes:

- `success` contains a validated proposal;
- `needs_input` contains the `communicate` message;
- `error` contains a concise public message and an error code.

An invalid first call receives one repair attempt. If the second call is also invalid, neither response changes project state. Provider failures likewise apply no project changes.

These are domain results returned by a Next.js server action, so the underlying HTTP request can complete with status 200 while the result itself has `status: "error"`. HTTP success means the server action returned normally; it does not mean generation succeeded.

In development builds, rejected provider responses and validation stacks are logged on the server and attached to the error result. The web application keeps the concise message inline and exposes the full diagnostic text only through **More details**, which opens a dialog. Production results omit those details entirely. A timeout has no rejected model response to display because no response was received.

## Output bounds

The harness accepts at most 100 scaffold files, 500,000 characters in any scaffold file, 2,000,000 scaffold characters in total, and 500,000 characters in a test-code result. These are application safety limits, not token-budget targets; prompts still ask for minimal output.

## Version metadata

Every result carries:

- `protocolVersion`: the machine-contract version;
- `promptVersion`: the prompt-policy release date;
- `operation`: the requested operation.

Version metadata identifies the exact harness contract used for a result and supports diagnostics.

## Provider configuration

The default provider is OpenCode Zen. `AI_BASE_URL`, `AI_MODEL`, `AI_REQUEST_TIMEOUT_MS`, and `AI_API_KEY` allow deployment-specific configuration. When `AI_API_KEY` is unset, the harness uses `OPENCODE_API_KEY`. The selected endpoint and model must implement OpenAI-compatible function calling; see the [environment reference](/reference/environment).
