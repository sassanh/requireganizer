# Requireganizer

Requireganizer is an AI-assisted requirements and test-design workspace. It turns a project description into a traceable chain of product overview, user stories, requirements, acceptance criteria, test scenarios, test cases, executable tests, and a deterministic project scaffold.

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

Open [http://localhost:3000](http://localhost:3000).

The default configuration uses an OpenCode Zen model. Configure credentials or another OpenAI-compatible function-calling endpoint and model through `.env.local`; see the [environment reference](docs/reference/environment.md).

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
