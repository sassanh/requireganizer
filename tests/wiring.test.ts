import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("provider wiring", () => {
  it("takes the storage adapter from the project client instead of a context default", () => {
    const provider = source("app/provider.tsx");
    const context = source("app/projectContext.ts");

    assert.match(provider, /persistence:\s*client\.persistence/);
    assert.match(
      context,
      /createContext<ProjectContextValue \| null>\(null\)/,
    );
    assert.match(context, /throw new Error\("useProject must be used inside Providers\."\)/);
    assert.doesNotMatch(provider, /persistence:\s*webPersistence/);
  });

});
