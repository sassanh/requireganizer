# Getting started

## Prerequisites

- Node.js 22.13 or newer
- pnpm 11
- An OpenAI-compatible chat-completions endpoint and model that support formal function tools

The default configuration uses the OpenCode Zen gateway and the `muse-spark-1.3-contributor-free` model through a continuous agentic conversation. Set provider credentials or override the endpoint in `.env.local` when needed.

## Install and run

```bash
pnpm install
cp .env.example .env.local
pnpm run dev
```

Open `http://localhost:3000`.

The values in `.env.example` are usable defaults. Change the provider URL, model, timeout, or optional key in `.env.local` if you operate a different compatible endpoint. See [environment variables](/reference/environment) for the full reference.

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
