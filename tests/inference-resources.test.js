import assert from "node:assert/strict";
import test from "node:test";
import { recognizeWithCleanup } from "../backend/inference-resources.js";

function engineFixture({ encoderFails = false, decoderFails = false, decodeFails = false } = {}) {
    const allocated = [];
    function tensor() {
        const value = {
            location: "cpu", disposals: 0,
            dispose() { this.location = "none"; this.disposals++; }
        };
        allocated.push(value);
        return value;
    }
    const engine = {
        async init() {},
        encoderSession: { async run() {
            if (encoderFails) throw new Error("Encoder failed");
            return { features: tensor(), mask: tensor() };
        } },
        decoderSession: { async run() {
            if (decoderFails) throw new Error("Decoder failed");
            return { logits: tensor() };
        } },
        async recognize(input, vocab, mode) {
            assert.equal(mode, "number");
            const values = tensor();
            const mask = tensor();
            const encoded = await this.encoderSession.run({ pixel_values: values, pixel_mask: mask });
            values.dispose();
            mask.dispose();
            const ids = tensor();
            await this.decoderSession.run({ ...encoded, input_ids: ids });
            ids.dispose();
            if (decodeFails) throw new Error("Decode failed");
            encoded.features.dispose();
            encoded.mask.dispose();
            return { latex: "1=" };
        }
    };
    return { engine, allocated };
}

test("recognition disposes session outputs and restores session methods on success", async () => {
    const { engine, allocated } = engineFixture();
    const encoderRun = engine.encoderSession.run;
    const decoderRun = engine.decoderSession.run;
    assert.deepEqual(await recognizeWithCleanup(engine, {}, {}, "number"), { latex: "1=" });
    assert.ok(allocated.every(tensor => tensor.location === "none" && tensor.disposals === 1));
    assert.equal(engine.encoderSession.run, encoderRun);
    assert.equal(engine.decoderSession.run, decoderRun);
});

test("encoder, decoder and decode errors release all tracked tensors", async () => {
    for (const stage of ["encoderFails", "decoderFails", "decodeFails"]) {
        const { engine, allocated } = engineFixture({ [stage]: true });
        const run = engine.encoderSession.run;
        await assert.rejects(recognizeWithCleanup(engine, {}, {}, "number"), /failed/);
        assert.ok(allocated.every(tensor => tensor.location === "none" && tensor.disposals === 1));
        assert.equal(engine.encoderSession.run, run);
    }
});

test("repeated recognition and failures leave no undisposed test tensors", async () => {
    for (const failing of [false, true]) {
        const { engine, allocated } = engineFixture({ decoderFails: failing });
        for (let i = 0; i < 100; i++) {
            if (failing) await assert.rejects(recognizeWithCleanup(engine, {}, {}, "number"));
            else await recognizeWithCleanup(engine, {}, {}, "number");
            assert.equal(allocated.filter(tensor => tensor.location !== "none").length, 0);
        }
    }
});
