# Testing and quality

## Full local gate

```bash
pnpm run check
```

The command runs, in order:

1. ESLint across the repository.
2. Strict TypeScript checking without emission.
3. The compiled Node test suite.
4. The page build of the interface: a static export to `out/`.
5. The project server: the server build of the interface in `dist/ui/` and the command-line bundle `dist/requireganizer.mjs`, which together are the npm package.
6. The package check: `dist/` packed as npm ships it and installed outside the repository with no registry. It runs the command's help, then starts the MCP server as the Claude Code plugin declares it, with the packed version standing in for the one `npx` would fetch, for a project in another folder, and checks that it serves that project over MCP and in the page.
7. A production VitePress build, including link validation.

The same command runs for pull requests and pushes to `main`.

## Focused commands

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run server:build
pnpm run package:check
pnpm run docs:build
```

The test runner deletes `.test-dist` before every compilation and discovers only files produced by that compilation, keeping stale JavaScript out of the test run.
