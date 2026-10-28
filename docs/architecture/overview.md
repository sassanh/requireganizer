# System overview

Requireganizer is a Next.js application with a MobX State Tree project model, an agentic AI conversation runtime, and a VitePress documentation site. The interface builds to static files in one of two ways: a page build runs the project in the page with browser storage, and a server build is served by a Node project server that keeps one project in a file.

## Main boundaries

| Boundary | Responsibility |
| --- | --- |
| Screens and components | Review and edit artifacts, show statuses and impact, issue conversation commands. |
| Project host (`app/project-host/`) | The single writer of a project: owns the open session, the only writable store, its timeline, and the AI flows. It runs in the page or in the project server. |
| Project client (`app/project-client/`) | The replica the interface renders. Store actions called on it are forwarded to the host. |
| Connection (`app/connection/`) | The versioned JSON messages between host and client, and the in-process and WebSocket links that carry them. |
| Persistence adapter (`app/persistence/`) | Store projects, module timelines, revisions, and provider calls behind one asynchronous interface. |
| Project server (`server/`) | Serve one project from its file: the host with the file adapter, the WebSocket link its own pages connect to, and the static interface. One process serves a project at a time; any other process that needs the project connects to it, and takes over when it stops. The file adapter reports edits made to the file elsewhere. |
| MCP server (`server/mcp.ts`) | Serve a project's agent tools to a coding agent: the built-in agent's read tools and stage submission tools, and, while the agent answers change requests, thread replies; run in the host. |
| Project store | Own schema-v4 module registries and per-module artifacts, exact revision bindings, the review gate (approvals, verdicts, bases, the frontier), the conversation transcript, virtual files, import/export, and atomic state transitions. |
| Contract domain | Define boundary, formal-contract, structured-test, setup types and authoritative validation. |
| AI agent (`app/ai-agent/`) | Run a continuous pi-agent conversation: one system prompt, short structured commands per user action, artifact reads through tools, and validated result tools that apply proposals. Models are called directly, from wherever the host runs. |
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
app/ai-agent/          conversation engine: system prompt, commands, read/result tools, AI settings and endpoint calls
app/store/             project model, status, client orchestration, import/export
app/project-session/   the open project: modules, autosave, timeline attachment
app/project-host/      the project authority that clients connect to
app/project-client/    the replica the interface renders and the requests it sends
app/connection/        host–client protocol and its in-process and WebSocket links
app/persistence/       the storage adapter and its web and memory implementations
server/                the project server: file adapter, WebSocket endpoint, MCP server, command line
skills/                the Skill that teaches coding agents the workflow
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
