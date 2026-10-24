# Environment variables

The project server (`requireganizer`, `pnpm run dev`) reads these variables when it starts. Restart it after changing them.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_API_KEY` | None | Bearer token for the endpoint. Without it, AI actions fail and say to set it. |
| `AI_BASE_URL` | `https://openrouter.ai/api/v1` | Base URL of an OpenAI-compatible Responses API. |
| `AI_MODEL` | `nvidia/nemotron-3-ultra-550b-a55b:free` | The model that writes. |
| `AI_REVIEWER_MODEL` | None | Reviewer model id on the same endpoint. Unset means no model verdicts and no auto review. |
| `XDG_STATE_HOME` | `~/.local/state` | The server keeps each project's history (timelines, revisions, provider calls) under `requireganizer/projects/` here. |

`requireganizer --env-file <path>` reads the variables from a file; `pnpm run dev` reads `.env.local`.

The page build runs without a server. It takes the same four AI settings from **AI settings** on the home page and the project menu, and stores them in that browser only. It calls the endpoint from the page, so the endpoint must accept cross-origin requests: OpenRouter does; OpenCode Zen does not, so use Zen only through a server.

Requireganizer never changes a configured model on its own, because model identity affects output quality, caching, and reproducibility.

## Compatibility requirements

The configured service and model must support OpenAI-compatible **streaming** chat completions with:

- request `tools` entries of `type: "function"` containing JSON Schema parameters;
- streamed deltas at `choices[0].delta`, including `reasoning_content` for thinking-capable models;
- usage reported on the final chunk without `stream_options` (the gateway hangs when `stream_options.include_usage` is sent);
- no reliance on the `store` request field.

The model must accept reasoning effort values of `low`, `high`, or `max`; these are mapped from pi thinking levels in `app/ai-agent/model.ts`.

## Retry and timeout behavior

Each turn makes a single streaming attempt, with no application-level retries. Transient provider failures surface as an error event in the conversation stream and then as a validation error in the UI, where the command can be reissued.

Proposal repair happens inside the conversation: validation failures of a submitted proposal are returned to the model as tool results so it can correct and resubmit within the same turn.
