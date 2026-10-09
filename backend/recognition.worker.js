import { TexTellerEngine } from "./texteller.js";
import { preprocessStrokes, IMAGE_MEAN, IMAGE_STD } from "./preprocessing.js";
import { recognizeWithCleanup } from "./inference-resources.js";
import * as ort from "onnxruntime-web/wasm";
import runtimeModuleUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import runtimeBinaryUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

// Keep the WASM module as a separate asset so its pthread workers can import it.
ort.env.wasm.wasmPaths = {
    mjs: new URL(runtimeModuleUrl, import.meta.url).href,
    wasm: new URL(runtimeBinaryUrl, import.meta.url).href
};

let engine;
let activeRequest;

async function initialize() {
    try {
        engine = new TexTellerEngine();
        await engine.init();
        self.postMessage({ type: "ready" });
    } catch (error) {
        self.postMessage({ type: "init-error", message: error.message });
        // Close the worker to free even partially created runtime sessions.
        self.close();
    }
}

self.onmessage = async function (event) {
    const { strokes, version, type } = event.data;
    if (type === "cancel") {
        if (activeRequest?.version === version) activeRequest.cancelled = true;
        return;
    }
    const request = { version, cancelled: false };
    activeRequest = request;
    try {
        const input = preprocessStrokes(strokes);
        const pixels = new Uint8ClampedArray(input.tensor.length * 4);
        for (let i = 0; i < input.tensor.length; i++) {
            const gray = Math.round(Math.max(0, Math.min(1, input.tensor[i] * IMAGE_STD + IMAGE_MEAN)) * 255);
            pixels[i * 4] = gray;
            pixels[i * 4 + 1] = gray;
            pixels[i * 4 + 2] = gray;
            pixels[i * 4 + 3] = 255;
        }
        self.postMessage({
            type: "preview", version,
            width: input.width, height: input.height, pixels
        }, [pixels.buffer]);

        const result = await recognizeWithCleanup(engine, input, {
            isCancelled: () => request.cancelled
        });
        self.postMessage({ type: "result", version, latex: result.latex });
    } catch (error) {
        if (error.name === "AbortError") self.postMessage({ type: "cancelled", version });
        else self.postMessage({ type: "error", version, message: error.message });
    } finally {
        if (activeRequest === request) activeRequest = null;
    }
};

initialize();
