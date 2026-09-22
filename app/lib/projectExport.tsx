import { pdf } from "@react-pdf/renderer";
import { saveAs } from "file-saver";
import JSZip from "jszip";

import PDFDocument from "components/PDFDocument";
import { Store } from "store";
import { WorkflowStage } from "store/constants";
import { extractTestCaseCode } from "utilities/testParser";

import { buildProjectPayload, type ModuleRegistry } from "./moduleSchema";

export type CodeArchiveFormat = "zip" | "tar.gz" | "tar.bz2";
export type ProjectExportFormat = "pdf" | "txt" | "json";

/** One visible module of the export, in registry order. */
export interface ExportModule {
  /** The registry id: the stable identity behind a rename. */
  id: string;
  /** Null when the project has not enabled modules: no section heading. */
  name: string | null;
  store: Store;
}

interface ExportFile {
  path: string;
  content: string;
}

/**
 * One module's specification as plain text. The section label comes from
 * the store's own stage label, so module mode names the first stage the
 * same way the interface does.
 */
function specificationText(store: Store): string {
  return `
${store.stageLabel(WorkflowStage.ProductOverview)}:
${store.productOverview}

User Stories:
${store.userStories.map((story) => story.content).join("\n")}

Requirements:
${store.requirements.map((req) => req.content).join("\n")}

Acceptance Criteria:
${store.acceptanceCriteria.map((criteria) => criteria.content).join("\n")}

Test Scenarios:
${store.testScenarios
      .map(
        (testScenario) => `${testScenario.content}
${testScenario.testCases.map((testCase) => {
          const codeBlock = extractTestCaseCode(
            Array.from(store.scaffoldFiles),
            testScenario.id,
            testCase.id,
            store.implementationProfile?.language || "typescript"
          );

          const codeOutput = codeBlock ? `\n\n  Code:\n${codeBlock.split('\n').map(l => `    ${l}`).join('\n')}` : "";
          return `  Test Case: ${testCase.title}\n  Steps:\n${testCase.steps.split('\n').map(l => `    ${l}`).join('\n')}\n  Expected Result: ${testCase.expectedResult}${codeOutput}`;
        }).join("\n\n")}
`,
      )
      .join("\n")}
      `;
}

/** The code files of every visible module, namespaced by module directory. */
export function collectCodeFiles(
  modules: readonly ExportModule[],
): ExportFile[] {
  return modules.flatMap((module) =>
    module.store.scaffoldFiles.map((file) => ({
      path: module.name == null ? file.path : `${module.name}/${file.path}`,
      content: file.content,
    })),
  );
}

export async function exportProjectPdf(
  modules: readonly ExportModule[],
): Promise<void> {
  const blob = await pdf(<PDFDocument modules={modules} />).toBlob();
  saveAs(blob, "specification.pdf");
}

export function exportProjectText(modules: readonly ExportModule[]): void {
  const content = modules
    .map((module) =>
      module.name == null
        ? specificationText(module.store)
        : `=== ${module.name} ===\n${specificationText(module.store)}`,
    )
    .join("\n");
  saveAs(new Blob([content], { type: "text/plain;charset=utf-8" }), "specification.txt");
}

/**
 * The JSON payload export: the full registry with the live snapshot of
 * the active module folded in, archived modules included so nothing is
 * lost on a round trip.
 */
export function exportProjectJson(
  registry: ModuleRegistry,
  activeSnapshot: Record<string, unknown>,
): void {
  const content = JSON.stringify(
    buildProjectPayload(registry, activeSnapshot),
    null,
    2,
  );
  saveAs(new Blob([content], { type: "text/plain;charset=utf-8" }), "specification.json");
}

function createTar(files: ExportFile[]): Uint8Array<ArrayBuffer> {
    const out: Uint8Array[] = [];
    const encoder = new TextEncoder();

    for (const f of files) {
        const data = encoder.encode(f.content);
        const header = new Uint8Array(512);

        const writeString = (str: string, offset: number, size: number) => {
            const buf = encoder.encode(str);
            header.set(buf.subarray(0, Math.min(size, buf.length)), offset);
        };

        const writeOctal = (num: number, offset: number, size: number) => {
            writeString(num.toString(8).padStart(size - 1, "0") + "\0", offset, size);
        };

        let name = f.path;
        let prefix = "";
        if (name.length > 100) {
            const splitIdx = name.lastIndexOf("/", 155);
            if (splitIdx > -1) {
                prefix = name.slice(0, splitIdx);
                name = name.slice(splitIdx + 1);
            }
        }
        writeString(name, 0, 100);
        writeOctal(0o644, 100, 8); // mode
        writeOctal(0, 108, 8); // uid
        writeOctal(0, 116, 8); // gid
        writeOctal(data.length, 124, 12); // size
        writeOctal(Math.floor(Date.now() / 1000), 136, 12); // mtime
        writeString("0", 156, 1); // typeflag (regular file)
        writeString("ustar  \0", 257, 8); // magic & version
        writeString(prefix, 345, 155);

        // Calculate checksum
        header.fill(32, 148, 156); // fill checksum field with spaces
        let calc = 0;
        for (let i = 0; i < 512; i++) calc += header[i];
        writeOctal(calc, 148, 8); // write actual checksum
        // Last character of checksum should be space or null
        header[155] = 32;

        out.push(header);
        out.push(data);

        // pad to 512
        const padLen = (512 - (data.length % 512)) % 512;
        if (padLen > 0) out.push(new Uint8Array(padLen));
    }

    out.push(new Uint8Array(1024)); // Two EOF blocks (1024 zero bytes)

    const totalLen = out.reduce((a, b) => a + b.length, 0);
    const result = new Uint8Array(new ArrayBuffer(totalLen));
    let offset = 0;
    for (const chunk of out) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

/**
 * Every visible module's code as one archive, paths namespaced under the
 * module's directory when modules are enabled.
 */
export async function exportCodeArchive(
    format: CodeArchiveFormat,
    input: { activeStore: Store; modules: readonly ExportModule[] },
    reportError: (message: string) => void,
): Promise<void> {
    const { activeStore, modules } = input;
    const files = collectCodeFiles(modules);

    if (files.length === 0) {
        reportError("No code generated to export.");
        return;
    }

    const projectName =
        activeStore.productOverview.name?.replace(/[^a-z0-9]/gi, "_").toLowerCase() ||
        "project_scaffold";

    try {
        if (format === "zip") {
            const zip = new JSZip();
            for (const file of files) {
                zip.file(file.path, file.content);
            }
            const blob = await zip.generateAsync({ type: "blob" });
            saveAs(blob, `${projectName}.zip`);
        } else if (format === "tar.gz") {
            const tar = createTar(files);
            const cs = new CompressionStream("gzip");
            const writer = cs.writable.getWriter();
            writer.write(tar);
            writer.close();
            const res = new Response(cs.readable);
            const blob = await res.blob();
            saveAs(blob, `${projectName}.tar.gz`);
        } else if (format === "tar.bz2") {
            const tar = createTar(files);
            const compressjs = await import("compressjs");
            const bzip2 = compressjs.default?.Bzip2 || compressjs.Bzip2;
            const compressed = bzip2.compressFile(tar);
            const blob = new Blob([new Uint8Array(compressed)], { type: "application/x-bzip2" });
            saveAs(blob, `${projectName}.tar.bz2`);
        }
    } catch (err) {
        console.error("Export failed:", err);
        reportError("Export failed due to internal error.");
    }
}
