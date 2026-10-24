import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

import { build } from "esbuild";

/**
 * Build the project server. Application modules are compiled into its
 * bundle, resolved through the TypeScript paths; packages stay imports of
 * node_modules. The command-line build also exports the server build of the
 * interface into `dist/ui/`, which the bundle serves. `--dev` builds the
 * development server instead, whose interface Next serves itself.
 */
const development = process.argv.includes("--dev");

if (!development) {
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
  packages: "external",
  tsconfig: "tsconfig.json",
  sourcemap: true,
  logLevel: "warning",
  banner: development ? undefined : { js: "#!/usr/bin/env node" },
});
