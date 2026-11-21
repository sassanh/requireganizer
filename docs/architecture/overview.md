# System overview

Requireganizer is a Next.js application with a MobX State Tree project model. The interface builds to static files in one of two ways: a page build runs the project in the page with browser storage, and a server build is served by a Node project server that keeps one project in a file.

## Main boundaries

| Boundary | Responsibility |
| --- | --- |
| Screens and components | Show the stages, their items and threads, and the project's history. |
| Project host (`app/project-host/`) | The single writer of a project: owns the open session and the only writable store. It runs in the page or in the project server. |
| Project client (`app/project-client/`) | The replica the interface renders. Store actions called on it are forwarded to the host. |
| Connection (`app/connection/`) | The versioned JSON messages between host and client, and the in-process and WebSocket links that carry them. |
| Project session (`app/project-session/`) | The open project: its modules, saving, outside changes, the spec owner's focus and what the coding agent points them to. |
| History (`app/history/`) | Steps, undo and redo with where they put the focus, restore points, and how each kept state differs from the project now. It depends on storage, never the reverse. |
| Storage (`app/storage/`) | The project's stored shape, its parser, export and import, the record kept beside it, and the content-addressed pieces its states share. |
| Persistence adapter (`app/persistence/`) | Store projects and their records behind one asynchronous interface, in the browser or, through the project server, in files. |
| Workflow (`app/workflow/`) | The engine every module runs on: stages, kinds of item, references and dependencies, signatures, coverage, impacts, out of date, threads, and the rules every kind shares. It names no stage. |
| Requirements engineering (`app/requirements-engineering/`) | The stages from Module Overview to Acceptance Criteria, their kinds, questions and rules. |
| Test design (`app/test-design/`) | The Boundary and Abstract tests stages, their kinds, questions and rules. |
| Store (`app/store/`) | Composes the workflow from both modules' stages, with the examples published with each kind's rules. |
| Project server (`server/`) | Serve one project from its file: the host with the file adapter, the WebSocket link its pages connect to, and the static interface. One process serves a project at a time; any other process that needs the project connects to it, and takes over when it stops. |
| MCP server (`server/mcp.ts`, `app/ai-agent/agent-access.ts`) | Serve a project to a coding agent through tools; as a Claude Code channel, announce each thread the spec owner assigns the agent. |

## A change

```text
Page action or MCP tool → host store action → workflow checks the change
→ applied, or refused with every problem named
→ one undo step recorded → written to storage
```

## Source layout

```text
app/workflow/                  the engine: definitions, module state, records, threads, units, stage view
app/requirements-engineering/  stage definitions from Module Overview to Acceptance Criteria
app/test-design/               Boundary and Abstract tests stage definitions
app/store/                     the composed workflow and the examples of every kind
app/history/                   steps, undo and redo, restore points, differences from now
app/storage/                   stored shape, parser, export, the record beside it, pieces
app/project-session/           the open project
app/project-host/              the project authority that clients connect to
app/project-client/            the replica the interface renders
app/connection/                host–client protocol and its links
app/persistence/               the storage adapter and its web and memory implementations
app/ai-agent/                  the tools served to a coding agent
server/                        the project server: file adapter, WebSocket endpoint, MCP server, command line
skills/                        the Skill that teaches coding agents the stages
tests/                         engine and agent tool tests
```
