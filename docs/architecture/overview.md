# System overview

Requireganizer is a Next.js application with a MobX State Tree project model. The interface builds to static files in one of two ways: a page build runs the project in the page with browser storage, and a server build is served by a Node project server that keeps one project in a file.

## Main boundaries

| Boundary | Responsibility |
| --- | --- |
| Screens and components | Show the stages, their items and threads, and the project's history. |
| Project host (`shared/project-host/`) | The single writer of a project: owns the open session and the only writable store. It runs in the page or in the project server. |
| Project client (`shared/project-client/`) | The replica the interface renders. Store actions called on it are forwarded to the host. |
| Connection (`shared/connection/`) | The versioned JSON messages between host and client, and the in-process and WebSocket links that carry them. |
| Project session (`shared/project-session/`) | The open project: its modules, saving, outside changes, the spec owner's focus and what the coding agent points them to. |
| History (`modules/history/`) | Steps, undo and redo with where they put the focus, restore points, and how each kept state differs from the project now. It depends on storage, never the reverse. |
| Storage (`modules/storage/`) | The project's stored shape, its parser, export and import, the record kept beside it, and the content-addressed pieces its states share. |
| Persistence adapter (`modules/storage/persistence/`) | Store projects and their records behind one asynchronous interface, in the browser or, through the project server, in files. |
| Workflow (`modules/workflow/`) | The engine every module runs on: stages, kinds of item, references and dependencies, signatures, coverage, impacts, out of date, threads, and the rules every kind shares. It names no stage. |
| Requirements engineering (`modules/requirements-engineering/`) | The stages from Module Overview to Acceptance Criteria, their kinds, questions and rules. |
| Test design (`modules/test-design/`) | The Boundary and Abstract tests stages, their kinds, questions and rules. |
| Modules (`modules/modules/`) | The project's modules: naming, adding, renaming, archiving and bringing them back, and the read-only stores of the other modules that dependencies resolve against. |
| Store (`shared/store/`) | Composes the workflow from both modules' stages, with the examples published with each kind's rules. |
| Project server (`server/`) | Serve one project from its file: the host with the file adapter, the WebSocket link its pages connect to, and the static interface. One process serves a project at a time; any other process that needs the project connects to it, and takes over when it stops. |
| MCP server (`modules/agents/mcp/server.ts`, `modules/delegation/interface/`) | Serve a project to a coding agent through tools; as a Claude Code channel, announce each thread the spec owner assigns the agent. |

## A change

```text
Page action or MCP tool → host store action → workflow checks the change
→ applied, or refused with every problem named
→ one undo step recorded → written to storage
```

## Source layout

```text
app/                           Next.js routes only: layout, pages, global styles
modules/                       one directory per module of the product's spec
  workflow/                    the engine: definitions, module state, records, threads, units, stage view
  requirements-engineering/    stage definitions from Module Overview to Acceptance Criteria
  test-design/                 Boundary and Abstract tests stage definitions
  history/                     steps, undo and redo, restore points, differences from now
  storage/                     stored shape, parser, export, the record beside it, pieces, persistence adapters
  modules/                     the project's modules and how they link to each other
  agents/                      the agents, their tools and the MCP server
  delegation/                  threads assigned to agents and the tools that answer them
shared/                        code no single module owns
  store/                       the composed workflow and the examples of every kind
  project-session/             the open project
  project-host/                the project authority that clients connect to
  project-client/              the replica the interface renders
  connection/                  host–client protocol and its links
server/                        the project server: file adapter, WebSocket endpoint, command line
skills/                        the Skill that teaches coding agents the stages
tests/                         engine and agent tool tests
```
