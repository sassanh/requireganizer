# Getting started

## Prerequisites

- Node.js 22.13 or newer
- pnpm 11, to build from source
- An API key for an OpenAI-compatible Responses API whose model supports function tools; the default endpoint is OpenRouter

## Run it in the browser

The page build keeps projects in browser storage and calls the AI from the page with the key you enter under **AI settings**.

```bash
pnpm install
pnpm run build
```

Serve the static files in `out/` from any static host.

## Run it with a project server

The project server keeps one project in a file inside your repository, runs the AI with the key from its environment, and serves the interface.

```bash
cd path/to/your/repository
AI_API_KEY=your-key npx requireganizer
```

Without a path, the server uses the nearest `requireganizer.json` in the current folder or a folder above it, or creates one in the current folder; pass a path to use another file. It prints the address and opens the browser. The project file holds only the project; its history stays in the state directory.

One process at a time serves a project. Running the server again for a project that is already served opens the running one.

When the project file changes while it is served, such as after a checkout or a pull, the page asks whether to open the changed file or keep the version it shows. After opening the changed file, undo returns to the version the page showed.

See [environment variables](/reference/environment) for the AI settings.

## Use it from a coding agent

`requireganizer mcp` serves the project to a coding agent over MCP. For Claude Code, install the plugin, which brings the MCP server and the Skill that teaches the agent the workflow:

```bash
claude plugin install requireganizer --marketplace sassanh/requireganizer
```

Claude Code asks for the AI settings when it enables the plugin; without them, review stays manual.

Other agents run `npx -y requireganizer mcp` in the repository. Add `--env-file <path>` to give it the AI settings. The Skill is in `skills/requireganizer/`.

The agent reads every stage and submits stage work through the same tools, checks and review as Requireganizer's own AI. Only you approve, in the page.

When no other process serves the project, the agent's process serves it, page included, and prints the address to its log. When that process ends, another process still connected to the project takes over on the same address, so an open page reconnects.

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

The gate runs linting, strict TypeScript checks, contract and utility tests, the production application build, and the VitePress documentation build.

## Run the documentation site

```bash
pnpm run docs:dev
```

The documentation uses the GitHub Pages base path `/requireganizer/`. VitePress prints the exact local URL when the server starts.

## First project

1. Create a project. Optionally give a starting intent to draft the product overview once; skip to write the overview yourself. The intent is kept as revision 0 provenance.
2. Review the product overview. Approve each item; generated output is draft until you do.
3. Continue through each stage in order. Request change or Approve each item; the left bar is the signature.
4. Approve Boundary Design, the Implementation Profile, and each formal contract bundle after review, the same way: item by item.
5. Review any downstream impact before applying a new approved-artifact revision.
6. Generate Project Setup and then generate each automated test from its structured case.

The model calls `communicate` when required scope is missing or contradictory. The application exposes that as a needs-input message. Answer the question by improving the project data, then run the stage again.
