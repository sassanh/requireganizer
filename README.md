# Requireganizer

Requireganizer turns a product idea into the spec your code is built against: user stories, requirements, acceptance criteria, interface contracts, test cases and executable tests. Each item is traced to what it serves, and you approve each one. When something upstream changes, it shows exactly which items went stale. Coding agents read the approved spec and submit their stage work over MCP; only you approve.

The AI harness is contract-first: each operation exposes one scoped OpenAI-compatible function, validates its arguments and engineering relationships, and applies successful proposals atomically.

## Documentation

Read the [project documentation](docs/index.md) for the complete workflow, architecture, harness contracts, prompt design, state invalidation, testing, environment, and deployment model.

The published site is available at [sassanh.github.io/requireganizer](https://sassanh.github.io/requireganizer/).

## Quick start

Requirements:

- Node.js 22.13 or newer
- pnpm 11

```bash
pnpm install
cp .env.example .env.local
pnpm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Set `AI_API_KEY` in `.env.local` first; the default endpoint is OpenRouter.

Requireganizer runs either entirely in the browser, with projects in browser storage, or with a project server that keeps one project in a file in your repository. See [getting started](docs/guide/getting-started.md) and the [environment reference](docs/reference/environment.md).

## Quality gate

```bash
pnpm run check
```

This runs linting, strict TypeScript checks, unit and harness contract tests, the production application build, and the production VitePress build. GitHub Actions runs the same gate for pushes to `main` and pull requests.

To work on the docs locally:

```bash
pnpm run docs:dev
```

## Status

Requireganizer remains under active development. Generated artifacts require human review, and the final application-code stage is an architectural destination rather than a complete autonomous implementation pipeline.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

Requireganizer is released under the [MIT License](LICENSE).
