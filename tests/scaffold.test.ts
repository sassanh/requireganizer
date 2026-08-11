import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isSafeVirtualPath,
  parseScaffoldFiles,
  parseScaffoldFilesJson,
} from "../app/lib/scaffold";

describe("scaffold validation", () => {
  it("accepts ordinary project files", () => {
    assert.deepEqual(
      parseScaffoldFilesJson(
        '[{"path":"src/index.ts","content":"export {};"},{"path":".gitignore","content":"node_modules"}]',
      ),
      [
        { path: "src/index.ts", content: "export {};" },
        { path: ".gitignore", content: "node_modules" },
      ],
    );
  });

  it("rejects traversal, absolute, and platform-specific paths", () => {
    for (const path of ["../secret", "/etc/passwd", "C:/secret", "src\\file.ts"] ) {
      assert.equal(isSafeVirtualPath(path), false, path);
    }
  });

  it("rejects duplicate paths", () => {
    assert.throws(
      () =>
        parseScaffoldFiles([
          { path: "src/index.ts", content: "one" },
          { path: "src/index.ts", content: "two" },
        ]),
      /duplicate path/,
    );
  });

  it("rejects files without text content", () => {
    assert.throws(
      () => parseScaffoldFiles([{ path: "src/index.ts", content: 42 }]),
      /text content/,
    );
  });
});
