import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../backend/recognition.worker.js", import.meta.url), "utf8");

test("model startup failure reports an error and closes the worker; success stays available", async () => {
    for (const fails of [true, false]) {
        const messages = [];
        let closed = false;
        const context = vm.createContext({ self: {
            postMessage: message => messages.push(message),
            close() { closed = true; }
        } });
        const dependencies = {
            "./texteller.js": {
                TexTellerEngine: class { async init() {
                    if (fails) throw new Error("Decoder could not load");
                } }
            },
            "./preprocessing.js": { preprocessStrokes() {}, IMAGE_MEAN: 0.9545467, IMAGE_STD: 0.15394445 },
            "./inference-resources.js": { recognizeWithCleanup() {} }
        };
        const app = new vm.SourceTextModule(source, { context });
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
