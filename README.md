# Requireganizer

Requireganizer keeps the spec your code is built against, stage by stage: a module's purpose, capabilities, features and target users, needs, requirements, acceptance criteria, the boundary its tests use, and abstract tests. Each item is traced to what it builds on, and you sign each one. When something upstream changes, it shows exactly which items are out of date. Coding agents read the spec and write items over MCP; only you sign.

## Documentation

Read the [project documentation](docs/index.md) for the workflow, architecture, storage and recovery, testing, environment, and deployment.

The published site is available at [sassanh.github.io/requireganizer](https://sassanh.github.io/requireganizer/).

## Use it from Claude Code

```bash
claude plugin install requireganizer --marketplace sassanh/requireganizer
```

The plugin brings the MCP server and the Skill that teaches the agent the stages. See [getting started](docs/guide/getting-started.md) for the project server and the browser build.

## Quick start

Requirements:

- Node.js 22.13 or newer
- pnpm 11

```bash
pnpm install
cp .env.example .env.local
pnpm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

Requireganizer runs either entirely in the browser, with projects in browser storage, or with a project server that keeps one project in a file in your repository. See [getting started](docs/guide/getting-started.md) and the [environment reference](docs/reference/environment.md).

## Quality gate

```bash
pnpm run check
```

This runs linting, strict TypeScript checks, the tests, the production application build, and the production VitePress build. GitHub Actions runs the same gate for pushes to `main` and pull requests.

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
