import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MODEL_ASSET_PATH, MODEL_FILES, MODEL_REMOTE_URL } from "../backend/texteller-config.js";

const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
for (const file of MODEL_FILES) {
    const destination = resolve(publicRoot, MODEL_ASSET_PATH, file);
    if (await stat(destination).then(info => info.size > 0, () => false)) continue;
    await mkdir(dirname(destination), { recursive: true });
    const partial = `${destination}.part`;
    try {
        console.log(`Downloading TexTeller ${file}...`);
        const response = await fetch(`${MODEL_REMOTE_URL}/${file}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!response.body) throw new Error("Empty response body");
        const size = Number(response.headers.get("content-length"));
        await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
        const actualSize = (await stat(partial)).size;
        if (!actualSize || (size && actualSize !== size)) throw new Error("Incomplete download");
        await rename(partial, destination);
        console.log(`Saved ${file} (${(actualSize / 1e6).toFixed(1)} MB)`);
    } catch (error) {
        await rm(partial, { force: true });
        throw new Error(`Could not download TexTeller ${file}: ${error.message}`, { cause: error });
    }
}
console.log("TexTeller assets ready. Inference uses files served by this app.");
