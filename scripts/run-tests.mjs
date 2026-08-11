import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, resolve } from "node:path";

const require = createRequire(import.meta.url);
const outputDirectory = resolve(".test-dist");

rmSync(outputDirectory, { force: true, recursive: true });

const compiler = spawnSync(
  process.execPath,
  [require.resolve("typescript/bin/tsc"), "--project", "tsconfig.test.json"],
  { stdio: "inherit" },
);
if (compiler.status !== 0) {
  process.exit(compiler.status ?? 1);
}

const testDirectory = resolve(outputDirectory, "tests");
const testFiles = readdirSync(testDirectory)
  .filter((file) => file.endsWith(".test.js"))
  .sort()
  .map((file) => resolve(testDirectory, file));

if (testFiles.length === 0) {
  throw new Error("The test build did not produce any test files.");
}

const existingNodePath = process.env.NODE_PATH;
const tests = spawnSync(process.execPath, ["--test", ...testFiles], {
  env: {
    ...process.env,
    NODE_PATH: [resolve(outputDirectory, "app"), existingNodePath]
      .filter(Boolean)
      .join(delimiter),
  },
  stdio: "inherit",
});

process.exit(tests.status ?? 1);
