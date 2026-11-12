# Environment variables

The project server (`requireganizer`, `requireganizer mcp`, `pnpm run dev`) reads these variables when it starts. Restart it after changing them.

| Variable | Default | Purpose |
| --- | --- | --- |
| `XDG_STATE_HOME` | `~/.local/state` | The server keeps each project's undo history and restore points under `requireganizer/projects/` here. |
| `AI_API_KEY` | None | Key for the endpoint of Requireganizer's own AI. |
| `AI_BASE_URL` | `https://openrouter.ai/api/v1` | Base URL of an OpenAI-compatible Responses API. |
| `AI_MODEL` | `nvidia/nemotron-3-ultra-550b-a55b:free` | The model that writes. |
| `AI_REVIEWER_MODEL` | None | The model that reviews, on the same endpoint. |

`pnpm run dev` reads them from `.env.local`.

## Command-line options

| Option | Purpose |
| --- | --- |
| `--port <number>` | The port to listen on; by default the project's last port, else 4519, or the next free one. |
| `--env-file <path>` | Read the variables above from this file. |
| `--no-open` | Do not open the browser. |
