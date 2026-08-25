import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseProjectSetupProposal } from "../app/contract-domain";

const validSetup = {
  boundaryRevisionId: "boundary-r1",
  profileRevisionId: "profile-r1",
  contractSuiteRevisionId: "suite-r1",
  testDesignFingerprint: "fingerprint-1",
  configuration: {
    packageManager: "pnpm",
    testFramework: "node:test",
    buildCommand: "pnpm build",
    testCommand: "pnpm test",
    settings: { strict: true },
  },
  manifest: {
    language: "TypeScript",
    moduleNames: ["calculator"],
    sourceRoots: ["src"],
    testRoots: ["tests"],
    contractPlacements: [{
      interfaceContractRevisionId: "interface-r1",
      documentPath: "contracts/calculator.ts",
      scaffoldPath: "src/calculator.ts",
      sha256: "abc123",
    }],
    testTargets: [{ scenarioId: "scenario-1", path: "tests/add.test.ts" }],
    subjectBindings: [{
      subjectId: "product",
      subjectContractRevisionId: "subject-r1",
      moduleName: "calculator",
      sourcePath: "src/calculator.ts",
    }],
  },
  files: [{ path: "src/calculator.ts", content: "export const calc = 1" }],
};

function parseError(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected the parser to throw, but it succeeded.");
}

describe("project setup proposal parsing", () => {
  it("parses a complete setup", () => {
    const setup = parseProjectSetupProposal(validSetup);
    assert.equal(setup.manifest.language, "TypeScript");
    assert.equal(setup.manifest.contractPlacements.length, 1);
    assert.deepEqual(setup.configuration.settings, { strict: true });
    assert.equal(setup.files.length, 1);
  });

  it("rejects unknown keys at every level", () => {
    assert.match(
      parseError(() => parseProjectSetupProposal({ ...validSetup, extra: 1 })),
      /Project setup contains unsupported field "extra"/,
    );
    assert.match(
      parseError(() => parseProjectSetupProposal({
        ...validSetup,
        manifest: { ...validSetup.manifest, extra: 1 },
      })),
      /manifest contains unsupported field "extra"/,
    );
    assert.match(
      parseError(() => parseProjectSetupProposal({
        ...validSetup,
        configuration: { ...validSetup.configuration, extra: 1 },
      })),
      /configuration contains unsupported field "extra"/,
    );
    assert.match(
      parseError(() => parseProjectSetupProposal({
        ...validSetup,
        manifest: {
          ...validSetup.manifest,
          contractPlacements: [{
            ...validSetup.manifest.contractPlacements[0],
            extra: 1,
          }],
        },
      })),
      /contractPlacements\[0\] contains unsupported field "extra"/,
    );
    assert.match(
      parseError(() => parseProjectSetupProposal({
        ...validSetup,
        manifest: {
          ...validSetup.manifest,
          testTargets: [{ ...validSetup.manifest.testTargets[0], extra: 1 }],
        },
      })),
      /testTargets\[0\] contains unsupported field "extra"/,
    );
    assert.match(
      parseError(() => parseProjectSetupProposal({
        ...validSetup,
        manifest: {
          ...validSetup.manifest,
          subjectBindings: [{
            ...validSetup.manifest.subjectBindings[0],
            extra: 1,
          }],
        },
      })),
      /subjectBindings\[0\] contains unsupported field "extra"/,
    );
    assert.match(
      parseError(() => parseProjectSetupProposal({
        ...validSetup,
        files: [{ ...validSetup.files[0], extra: 1 }],
      })),
      /files\[0\] contains unsupported field "extra"/,
    );
  });

  it("rejects unsafe virtual paths in manifests and files", () => {
    assert.match(
      parseError(() => parseProjectSetupProposal({
        ...validSetup,
        manifest: { ...validSetup.manifest, sourceRoots: ["../outside"] },
      })),
      /safe relative POSIX path/,
    );
    assert.match(
      parseError(() => parseProjectSetupProposal({
        ...validSetup,
        files: [{ path: "../escape.ts", content: "x" }],
      })),
      /safe relative POSIX path/,
    );
  });

  it("rejects non-text file content", () => {
    assert.match(
      parseError(() => parseProjectSetupProposal({
        ...validSetup,
        files: [{ path: "src/x.ts", content: 42 }],
      })),
      /files\[0\]\.content must be text/,
    );
  });
});
