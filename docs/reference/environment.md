# Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_API_KEY` | None | Provider-neutral bearer token. Takes precedence when set. |
| `OPENCODE_API_KEY` | None | OpenCode Zen token used when `AI_API_KEY` is unset. |
| `AI_BASE_URL` | `https://opencode.ai/zen/v1` | Base URL for an OpenAI-compatible API. |
| `AI_MODEL` | `deepseek-v4-flash-free` | Chat-completions model used for all harness operations. |
| `AI_REQUEST_TIMEOUT_MS` | `60000` | Per-request transport timeout. Values below 1,000 ms fall back to the default. |

When neither key variable is set, the default OpenCode endpoint receives `public`, which enables its anonymous free-model access. Other providers normally require `AI_API_KEY`.

Copy `.env.example` to `.env.local` for local development. Do not commit credentials.

## Compatibility requirements

The configured service and model must support OpenAI-compatible non-streaming chat completions with:

- request `tools` entries of `type: "function"` containing JSON Schema parameters;
- `tool_choice: "required"`;
- `parallel_tool_calls: false`;
- a response at `choices[0].message.tool_calls`;
- function call `name` and JSON-string `arguments` fields.

## Retry and timeout behavior

The OpenAI SDK's internal retries are disabled. The application retries transient connection errors, SDK connection timeouts, HTTP 408, 409, 425, 429, server errors, and common transient network error codes. The default is three total attempts with exponential backoff.

Contract repair is separate. It runs only after a provider returned a formal tool call whose name, argument JSON, or semantics failed validation. A transport timeout has no raw model response to repair or display.
