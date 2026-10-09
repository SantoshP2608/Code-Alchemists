import { TexTellerEngine } from "./texteller.js";
import { preprocessStrokes, IMAGE_MEAN, IMAGE_STD } from "./preprocessing.js";
import { recognizeWithCleanup } from "./inference-resources.js";

let engine;

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
    const { strokes, version } = event.data;
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

        const result = await recognizeWithCleanup(engine, input);
        self.postMessage({ type: "result", version, latex: result.latex });
    } catch (error) {
        self.postMessage({ type: "error", version, message: error.message });
    }
};

initialize();
