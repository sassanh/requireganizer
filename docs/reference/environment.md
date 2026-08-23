# Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_API_KEY` | None | Provider-neutral bearer token. Takes precedence when set. |
| `OPENCODE_API_KEY` | None | OpenCode Zen token used when `AI_API_KEY` is unset. |
| `AI_BASE_URL` | `https://opencode.ai/zen/v1` | Base URL for an OpenAI-compatible API. |

When neither key variable is set, the default endpoint receives `public` as its bearer credential. Other providers normally require `AI_API_KEY`. The conversation model is pinned in `app/ai-agent/model.ts`; Requireganizer does not silently change models because model identity affects output quality, caching, and reproducibility.

Copy `.env.example` to `.env.local` for local development. Do not commit credentials.

## Compatibility requirements

The configured service and model must support OpenAI-compatible **streaming** chat completions with:

- request `tools` entries of `type: "function"` containing JSON Schema parameters;
- streamed deltas at `choices[0].delta`, including `reasoning_content` for thinking-capable models;
- usage reported on the final chunk without `stream_options` (the gateway hangs when `stream_options.include_usage` is sent);
- no reliance on the `store` request field.

The model must accept reasoning effort values of `low`, `high`, or `max`; these are mapped from pi thinking levels in `app/ai-agent/model.ts`.

## Retry and timeout behavior

The proxy route performs a single streaming attempt per turn and performs no application-level retries. Transient provider failures surface as an error event in the conversation stream and then as a validation error in the UI, where the command can be reissued.

Proposal repair happens inside the conversation: validation failures of a submitted proposal are returned to the model as tool results so it can correct and resubmit within the same turn.
