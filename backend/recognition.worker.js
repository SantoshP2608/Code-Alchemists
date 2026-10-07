import * as ort from "onnxruntime-web";
import { InferenceEngine, loadVocab } from "ink-on/core";
import { preprocessStrokes } from "./preprocessing.js";

// One WASM thread inside this worker keeps the drawing thread free.
// It also works without cross-origin isolation headers.
ort.env.wasm.numThreads = 1;

let engine;
let vocab;

async function initialize() {
    try {
        vocab = await loadVocab("/models/comer/vocab.json");
        engine = new InferenceEngine({
            encoderUrl: "/models/comer/encoder_int8.onnx",
            decoderUrl: "/models/comer/decoder_int8.onnx",
            executionProvider: "wasm"
        });
        await engine.init();
        self.postMessage({ type: "ready" });
    } catch (error) {
        self.postMessage({ type: "init-error", message: error.message });
    }
}

self.onmessage = async function (event) {
    const { strokes, version } = event.data;
    try {
        const input = preprocessStrokes(strokes);
        const pixels = new Uint8ClampedArray(input.tensor.length * 4);
        for (let i = 0; i < input.tensor.length; i++) {
            const gray = Math.round(input.tensor[i] * 255);
            pixels[i * 4] = gray;
            pixels[i * 4 + 1] = gray;
            pixels[i * 4 + 2] = gray;
            pixels[i * 4 + 3] = 255;
        }
        self.postMessage({
            type: "preview", version,
            width: input.width, height: input.height, pixels
        }, [pixels.buffer]);

        const result = await engine.recognize(input, vocab, "number");
        self.postMessage({ type: "result", version, latex: result.latex });
    } catch (error) {
        self.postMessage({ type: "error", version, message: error.message });
    }
};

initialize();
