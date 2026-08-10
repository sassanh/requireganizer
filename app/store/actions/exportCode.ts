import { saveAs } from "file-saver";
import JSZip from "jszip";

import { Store } from "store";
import { ScaffoldFileModel } from "store/store";
import { Instance } from "mobx-state-tree";

type ScaffoldFile = Instance<typeof ScaffoldFileModel>;

function createTar(files: ScaffoldFile[]): Uint8Array {
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
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of out) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

export const exportCode = (
    self_: unknown,
    format: "zip" | "tar.gz" | "tar.bz2",
) => {
    const self = self_ as Store;
    const files = self.scaffoldFiles;

    if (files.length === 0) {
        self.setValidationErrors({ validationErrors: "No code generated to export." });
        setTimeout(() => self.resetValidationErrors(), 3000);
        return;
    }

    const projectName =
        self.productOverview.name?.replace(/[^a-z0-9]/gi, "_").toLowerCase() ||
        "project_scaffold";

    const executeExport = async () => {
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
                // @ts-expect-error Untyped dynamic import
                const compressjs = await import("compressjs");
                const bzip2 = compressjs.default?.Bzip2 || compressjs.Bzip2;
                const compressed = bzip2.compressFile(tar);
                const blob = new Blob([new Uint8Array(compressed)], { type: "application/x-bzip2" });
                saveAs(blob, `${projectName}.tar.bz2`);
            }
        } catch (err) {
            console.error("Export failed:", err);
            self.setValidationErrors({ validationErrors: "Export failed due to internal error." });
            setTimeout(() => self.resetValidationErrors(), 3000);
        }
    };

    executeExport();
};

export default exportCode;
