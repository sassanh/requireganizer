import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

import { build } from "esbuild";

/**
 * Build the project server. `--dev` builds the development server, whose
 * interface Next serves itself; its packages stay imports of node_modules.
 * Otherwise this builds `dist/`, the npm package: the server build of the
 * interface in `dist/ui/`, which the bundle serves, and a bundle that holds
 * every package it uses, so the package installs with no dependencies.
 */
const development = process.argv.includes("--dev");

if (!development) {
  // The package is what this build writes, and nothing an earlier one left.
  rmSync("dist", { recursive: true, force: true });
  const require = createRequire(import.meta.url);
  const interfaceBuild = spawnSync(process.execPath, [require.resolve("next/dist/bin/next"), "build"], {
    stdio: "inherit",
    env: { ...process.env, NEXT_PUBLIC_PROJECT_HOST: "server" },
  });
  if (interfaceBuild.status !== 0) process.exit(interfaceBuild.status ?? 1);
}

await build({
  entryPoints: [development ? "server/dev.ts" : "server/main.ts"],
  outfile: development ? ".server-dist/dev.mjs" : "dist/requireganizer.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: development ? "external" : undefined,
  tsconfig: "tsconfig.json",
  sourcemap: development,
  logLevel: "warning",
  // Bundled CommonJS packages require Node's own modules.
  banner: development ? undefined : {
    js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from \"node:module\";\nconst require = __createRequire(import.meta.url);",
  },
});

if (!development) {
  const source = JSON.parse(readFileSync("package.json", "utf8"));
  const manifest = {
    name: source.name,
    version: source.version,
    description: source.description,
    license: source.license,
    author: source.author,
    repository: source.repository,
    homepage: source.homepage,
    engines: source.engines,
    bin: { requireganizer: "requireganizer.mjs" },
  };
  writeFileSync("dist/package.json", `${JSON.stringify(manifest, null, 2)}\n`);
  copyFileSync("README.md", "dist/README.md");
  copyFileSync("LICENSE", "dist/LICENSE");
}
