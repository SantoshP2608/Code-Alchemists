import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { recognizeWithCleanup } from "../backend/inference-resources.js";
import { unwrapMathDelimiters } from "../backend/texteller.js";
import { formatLatex } from "../backend/formatter.js";
import createEvaluator from "../backend/evaluate.js";
import * as modelConfig from "../backend/texteller-config.js";

const source = await readFile(new URL("../backend/texteller.js", import.meta.url), "utf8");

async function fixture({ failDecoder = false, failRun = false, neverEnd = false, fetchFails = false } = {}) {
    const allocated = [], prefixes = [], urls = [], released = [];
    class Tensor {
        constructor(type, data, dims) { Object.assign(this, { type, data, dims, location: "cpu" }); allocated.push(this); }
        dispose() { assert.notEqual(this.location, "none"); this.location = "none"; }
    }
    const ort = { env: { wasm: {} }, Tensor, InferenceSession: { async create(url) {
        urls.push(url);
        if (url.includes("decoder") && failDecoder) throw new Error("Decoder load failed");
        return {
            async release() { released.push(url); },
            async run(feeds) {
                if (url.includes("encoder")) {
                    assert.deepEqual(Array.from(feeds.pixel_values.dims), [1, 1, 448, 448]);
                    return { last_hidden_state: new Tensor("float32", new Float32Array(2), [1, 1, 2]) };
                }
                prefixes.push(Array.from(feeds.input_ids.data, Number));
                if (failRun) throw new Error("Decoder run failed");
                assert.ok(feeds.encoder_hidden_states);
                const count = feeds.input_ids.dims[1];
                const logits = new Float32Array(count * 5);
                // Earlier token positions deliberately disagree with the last.
                logits[0] = 100;
                logits[(count - 1) * 5 + (count === 1 || neverEnd ? 4 : 2)] = 200;
                return { logits: new Tensor("float32", logits, [1, count, 5]) };
            }
        };
    } } };
    const context = vm.createContext({ fetch: async url => {
        if (fetchFails) throw new Error("Failed to fetch");
        return { ok: true, json: async () => {
        urls.push(url);
        return url.endsWith("config.json") && !url.includes("tokenizer")
            ? { decoder: { decoder_start_token_id: 2, eos_token_id: 2 } } : {};
    } };
    }, BigInt64Array, Float32Array });
    const module = new vm.SourceTextModule(source, { context });
    await module.link(name => {
        const values = name === "./texteller-config.js" ? modelConfig : name === "onnxruntime-web" ? ort : { Tokenizer: class {
            decode(ids, options) {
                assert.deepEqual(Array.from(ids), neverEnd ? [] : [4]);
                assert.equal(options.skip_special_tokens, true);
                return "\\[1=\\]";
            }
        } };
        return new vm.SyntheticModule(Object.keys(values), function () {
            for (const [key, value] of Object.entries(values)) this.setExport(key, value);
        }, { context });
    });
    await module.evaluate();
    return { engine: new module.namespace.TexTellerEngine(), allocated, prefixes, urls, released };
}

test("TexTeller uses pinned quantized weights, full prefixes and last-position logits", async () => {
    const f = await fixture();
    await f.engine.init();
    const result = await recognizeWithCleanup(f.engine, { tensor: new Float32Array(448 * 448) });
    assert.equal(result.latex, "1=");
    assert.deepEqual(f.prefixes, [[2], [2, 4]]);
    assert.ok(f.urls.every(url => url.includes("9727784d91d7f8437dc7140941c4335284ce075e")));
    assert.ok(f.urls.every(url => url.startsWith("/models/texteller/")));
    assert.ok(f.urls.some(url => url.endsWith("decoder_model_quantized.onnx")));
    assert.ok(f.allocated.every(t => t.location === "none"));
});

test("actual TexTeller sample framing reaches the unchanged formatter and WASM calculator", async () => {
    const wasmModule = new WebAssembly.Module(await readFile(new URL("../backend/evaluate.wasm", import.meta.url)));
    const evaluator = await createEvaluator({ instantiateWasm(imports, receiveInstance) {
        const instance = new WebAssembly.Instance(wasmModule, imports);
        receiveInstance(instance);
        return instance.exports;
    } });
    for (const raw of ["\\[1=\\]", "\\(1=\\)", "$1=$", "$$1=$$", " 1= "]) {
        const expression = formatLatex(unwrapMathDelimiters(raw));
        assert.equal(expression, "1=");
        assert.equal(evaluator.calculate(expression), "1");
    }
    assert.throws(() => formatLatex(unwrapMathDelimiters("\\[x^2=\\]")), /Unsupported/);
    assert.equal(unwrapMathDelimiters("\\[1="), "\\[1=");
});

test("TexTeller releases a loaded encoder when decoder startup fails", async () => {
    const f = await fixture({ failDecoder: true });
    await assert.rejects(f.engine.init(), /Decoder load failed/);
    assert.equal(f.released.length, 1);
});

test("model download failures identify the failing local file", async () => {
    const f = await fixture({ fetchFails: true });
    await assert.rejects(f.engine.init(), /TexTeller config.json: Failed to fetch/);
    assert.equal(f.released.length, 0);
});

test("TexTeller decoder errors and token-limit failures release all tensors", async () => {
    for (const options of [{ failRun: true }, { neverEnd: true }]) {
        const f = await fixture(options);
        await f.engine.init();
        await assert.rejects(recognizeWithCleanup(f.engine, { tensor: new Float32Array(448 * 448) }),
            options.failRun ? /Decoder run failed/ : /256-token/);
        assert.ok(f.allocated.every(t => t.location === "none"));
    }
});
