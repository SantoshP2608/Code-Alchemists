import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../backend/recognition.worker.js", import.meta.url), "utf8");

test("model startup failure reports an error and closes the worker; success stays available", async () => {
    for (const fails of [true, false]) {
        const messages = [];
        let closed = false;
        const context = vm.createContext({ URL, self: {
            postMessage: message => messages.push(message),
            close() { closed = true; }
        } });
        const dependencies = {
            "onnxruntime-web/wasm": { env: { wasm: {} } },
            "onnxruntime-web/ort-wasm-simd-threaded.mjs?url": { default: "/ort.mjs" },
            "onnxruntime-web/ort-wasm-simd-threaded.wasm?url": { default: "/ort.wasm" },
            "./texteller.js": {
                TexTellerEngine: class { async init() {
                    if (fails) throw new Error("Decoder could not load");
                } }
            },
            "./preprocessing.js": { preprocessStrokes() {}, IMAGE_MEAN: 0.9545467, IMAGE_STD: 0.15394445 },
            "./inference-resources.js": { recognizeWithCleanup() {} }
        };
        const app = new vm.SourceTextModule(source, { context,
            initializeImportMeta(meta) { meta.url = "http://localhost/backend/recognition.worker.js"; }
        });
        await app.link(name => {
            const exports = dependencies[name];
            return new vm.SyntheticModule(Object.keys(exports), function () {
                for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
            }, { context });
        });
        await app.evaluate();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(closed, fails);
        assert.equal(messages.length, 1);
        assert.equal(messages[0].type, fails ? "init-error" : "ready");
        if (fails) assert.equal(messages[0].message, "Decoder could not load");
    }
});

test("worker cancels only the matching request and stays available for subsequent recognition", async () => {
    const messages = [];
    let resume, cancelled;
    const pending = new Promise(resolve => { resume = resolve; });
    const self = { postMessage: message => messages.push(message), close() {} };
    const context = vm.createContext({ URL, self });
    const dependencies = {
        "onnxruntime-web/wasm": { env: { wasm: {} } },
        "onnxruntime-web/ort-wasm-simd-threaded.mjs?url": { default: "/ort.mjs" },
        "onnxruntime-web/ort-wasm-simd-threaded.wasm?url": { default: "/ort.wasm" },
        "./texteller.js": { TexTellerEngine: class { async init() {} } },
        "./preprocessing.js": { IMAGE_MEAN: 0.9545467, IMAGE_STD: 0.15394445,
            preprocessStrokes: () => ({ tensor: new Float32Array(1), width: 1, height: 1 }) },
        "./inference-resources.js": { async recognizeWithCleanup(engine, input, { isCancelled }) {
            cancelled = isCancelled;
            await pending;
            if (isCancelled()) {
                const error = new Error("Cancelled"); error.name = "AbortError"; throw error;
            }
            return { latex: "1=" };
        } }
    };
    const app = new vm.SourceTextModule(source, { context,
        initializeImportMeta(meta) { meta.url = "http://localhost/backend/recognition.worker.js"; }
    });
    await app.link(name => {
        const exports = dependencies[name];
        return new vm.SyntheticModule(Object.keys(exports), function () {
            for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
        }, { context });
    });
    await app.evaluate();
    await new Promise(resolve => setImmediate(resolve));
    const recognition = self.onmessage({ data: { strokes: [], version: 10 } });
    await self.onmessage({ data: { type: "cancel", version: 9 } });
    assert.equal(cancelled(), false);
    await self.onmessage({ data: { type: "cancel", version: 10 } });
    assert.equal(cancelled(), true);
    resume(); await recognition;
    assert.equal(messages.at(-1).type, "cancelled");
    assert.equal(messages.at(-1).version, 10);
    await self.onmessage({ data: { strokes: [], version: 11 } });
    assert.equal(messages.at(-1).type, "result");
    assert.equal(messages.at(-1).latex, "1=");
});
