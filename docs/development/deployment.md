# GitHub Pages deployment

Documentation is published by `.github/workflows/docs.yml`.

## Pipeline

On a push to `main` that changes documentation, the lockfile, package metadata, or the workflow:

1. GitHub checks out full history.
2. CI installs the pinned pnpm and Node versions.
3. Dependencies are installed from the frozen lockfile.
4. VitePress builds `docs/.vitepress/dist`.
5. The build directory is uploaded as a Pages artifact.
6. The deploy job publishes that artifact to the `github-pages` environment.

The workflow also supports manual dispatch. Deployment concurrency does not cancel an in-progress publish, preventing a partially replaced Pages release.

## Repository setup

In **Settings → Pages**, set the build and deployment source to **GitHub Actions**. The workflow requires these permissions, declared at workflow level:

- `contents: read`
- `pages: write`
- `id-token: write`

The expected site URL is `https://sassanh.github.io/requireganizer/`.

## Pull-request validation

The quality workflow builds the docs through `pnpm run check`, but it does not publish from pull requests. Only the dedicated Pages workflow deploys, and only from `main` or a manual run.

## Troubleshooting

- A blank or asset-less page usually indicates an incorrect VitePress `base`.
- A missing package during CI usually means `pnpm-lock.yaml` was not updated with `package.json`.
- A deployment permission error usually means Pages is not configured for GitHub Actions or the workflow permissions were changed.
- Broken internal links fail `pnpm run docs:build`; fix them before deployment.
