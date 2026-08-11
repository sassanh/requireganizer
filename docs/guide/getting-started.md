# Getting started

## Prerequisites

- Node.js 22.13 or newer
- pnpm 11
- An OpenAI-compatible chat-completions endpoint and model that support formal function tools

The default configuration uses the OpenCode Zen gateway and its free `deepseek-v4-flash-free` model. An API key is optional for that default endpoint.

## Install and run

```bash
pnpm install
cp .env.example .env.local
pnpm run dev
```

Open `http://localhost:3000`.

The values in `.env.example` are usable defaults. Change the provider URL, model, timeout, or key in `.env.local` if you operate a different compatible endpoint. See [environment variables](/reference/environment) for the full reference.

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

1. Write a concrete project description with intended users, key behavior, boundaries, and mandatory technical constraints.
2. Generate and review the product overview.
3. Continue through each stage in order. Do not treat generated output as approved merely because it passed structural validation.
4. Regenerate a stage marked **Outdated** after changing its upstream inputs.
5. Lock the generated project configuration before creating the scaffold or executable tests.

The model calls `communicate` when required scope is missing or contradictory. The application exposes that as a needs-input message. Answer the question by improving the project data, then run the stage again.
