# System overview

Requireganizer is a Next.js application with a MobX State Tree project model, an agentic AI conversation runtime, IndexedDB recovery/activity stores, and a VitePress documentation site.

## Main boundaries

| Boundary | Responsibility |
| --- | --- |
| Screens and components | Review and edit artifacts, show statuses and impact, issue conversation commands. |
| Project host (`app/project-host/`) | The single writer of a project: owns the open session, the only writable store, its timeline, and the AI flows. In the browser it runs in the page. |
| Project client (`app/project-client/`) | The replica the interface renders. Store actions called on it are forwarded to the host. |
| Connection (`app/connection/`) | The JSON messages between host and client, and the in-process link that sends them. |
| Persistence adapter (`app/persistence/`) | Store projects, module timelines, revisions, and provider calls behind one asynchronous interface. |
| Project store | Own schema-v4 module registries and per-module artifacts, exact revision bindings, the review gate (approvals, verdicts, bases, the frontier), the conversation transcript, virtual files, import/export, and atomic state transitions. |
| Contract domain | Define boundary, formal-contract, structured-test, setup types and authoritative validation. |
| AI agent (`app/ai-agent/`) | Run a continuous pi-agent conversation: one system prompt, short structured commands per user action, artifact reads through tools, and validated result tools that apply proposals. |
| AI proxy (`app/api/ai/proxy`) | Stream LLM requests to the OpenCode Zen gateway with the server-held credential; never expose keys to the browser. |
| Browser databases | Partition provider calls and recovery snapshots per project. |

## Request path

```text
User action → prerequisite check → structured command ({"kind":"generate","stage":...})
→ continuous conversation turn (pi agent loop)
→ read tools fetch live artifacts from the store → model reasons
→ submit_* result tool → authoritative parse + semantic validation
→ proposal applied atomically (or validation error returned to the model for self-repair)
```

The conversation transcript persists with the project; thinking and tool activity stream into the overlay dialog while a command runs.

## Source layout

```text
app/contract-domain/   revisioned artifact types, schema projection, validation, hashing
app/ai-harness/        formal tool schemas, parsers, workflow definitions, test-code guards
app/ai-agent/          conversation engine: system prompt, commands, read/result tools, proxy client
app/api/ai/proxy/      credential-holding streaming proxy to the LLM gateway
app/store/             project model, status, client orchestration, import/export
app/project-session/   the open project: modules, autosave, timeline attachment
app/project-host/      the project authority that clients connect to
app/project-client/    the replica the interface renders and the requests it sends
app/connection/        host–client protocol and the in-process link
app/persistence/       the storage adapter and its web and memory implementations
app/lib/               browser persistence and safe filesystem utilities
docs/                  VitePress product and engineering contracts
tests/                 agent tools, domain, state, persistence, and rendering tests
```

## Design principles

- Ground implementation formalization in complete, validated upstream artifacts; a newer revision supersedes the old one.
- Generate tests only from exact approved contract revisions.
- Treat provider schemas as transport hints and runtime validation as authoritative.
- Commands say when to work; artifacts are read through tools, never embedded in prompts.
- Validation errors flow back into the conversation so the model repairs its own proposals.
- Keep project behavior out of scaffold seams.
- Preserve stale work for inspection and block it from further generation.
- Snapshot before applying a revision with downstream impact.
- Keep the virtual project filesystem separate from the Code workflow stage.
