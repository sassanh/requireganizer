# Getting started

## Prerequisites

- Node.js 22.13 or newer
- pnpm 11, to build from source

## Run it in the browser

The page build keeps projects in browser storage.

```bash
pnpm install
pnpm run build
```

Serve the static files in `out/` from any static host.

## Run it with a project server

The project server keeps one project in a file inside your repository and serves the interface.

```bash
cd path/to/your/repository
npx requireganizer
```

Without a path, the server uses the nearest `requireganizer.json` in the current folder or a folder above it, or creates one in the current folder; pass a path to use another file.

One process at a time serves a project. Running the server again for a project that is already served opens the running one.

## Use it from a coding agent

`requireganizer mcp` serves the project to a coding agent over MCP. For Claude Code, install the plugin, which brings the MCP server and the Skill that teaches the agent the stages:

```bash
claude plugin install requireganizer --marketplace sassanh/requireganizer
```

Other agents run `npx -y requireganizer mcp` in the repository. The Skill is in `skills/requireganizer/`.

The agent reads each stage's items and each kind's published rules, writes items, and answers your change requests. Only you sign, in the page.

When no other process serves the project, the agent's process serves it, page included, and prints the address to its log.

## Develop

```bash
cp .env.example .env.local
pnpm run dev
```

`pnpm run server:build` builds the package into `dist/`; `node dist/requireganizer.mjs` runs it as `npx requireganizer` would. `pnpm run dev` runs the server build with hot reload on `http://127.0.0.1:3000`, serving the project in `local/requireganizer.json`; pass a path to serve another. `pnpm run dev:browser` runs the page build instead.

## Run the quality gate

```bash
pnpm run check
```


## Run the documentation site

```bash
pnpm run docs:dev
```

The documentation uses the GitHub Pages base path `/requireganizer/`.

## First project

1. Create a project. Its first module opens at Module Overview.
2. Write the purpose, or ask the coding agent to write it, then sign it.
3. Go through the stages in order: read each kind's rules, have items written, request changes where they fall short, and sign each item, coverage and impact.
