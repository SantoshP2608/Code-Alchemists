import * as ort from "onnxruntime-web/wasm";
import { Tokenizer } from "@huggingface/tokenizers";
import { MODEL_ASSET_PATH } from "./texteller-config.js";

const MODEL_URL = `${import.meta.env?.BASE_URL ?? "/"}${MODEL_ASSET_PATH}`;
// Shared WASM memory requires isolation headers. Keep a one-thread fallback
// for hosts/browsers without it, and leave CPU capacity for drawing.
ort.env.wasm.numThreads = globalThis.crossOriginIsolated
    ? Math.max(1, Math.min(4, globalThis.navigator?.hardwareConcurrency || 1)) : 1;
ort.env.wasm.proxy = false;

// TexTeller can wrap a formula in display/inline math delimiters. These are
// output framing, so remove them before handing LaTeX to the existing formatter.
export function unwrapMathDelimiters(text) {
    const latex = text.trim();
    for (const [start, end] of [["\\[", "\\]"], ["\\(", "\\)"], ["$$", "$$"], ["$", "$"]]) {
        if (latex.startsWith(start) && latex.endsWith(end) && latex.length >= start.length + end.length) {
            return latex.slice(start.length, -end.length).trim();
        }
    }
    return latex;
}

async function loadJSON(file) {
    try {
        const response = await fetch(`${MODEL_URL}/${file}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}; run npm run models:download`);
        return await response.json();
    } catch (error) {
        throw new Error(`TexTeller ${file}: ${error.message}`, { cause: error });
    }
}

async function loadSession(file, options) {
    try {
        return await ort.InferenceSession.create(`${MODEL_URL}/${file}`, options);
    } catch (error) {
        throw new Error(`TexTeller ${file}: ${error.message}`, { cause: error });
    }
}

export class TexTellerEngine {
    async init() {
        try {
            const [config, tokenizer, tokenizerConfig] = await Promise.all([
                loadJSON("config.json"), loadJSON("tokenizer.json"), loadJSON("tokenizer_config.json")
            ]);
            this.startToken = config.decoder.decoder_start_token_id;
            this.endToken = config.decoder.eos_token_id;
            this.tokenizer = new Tokenizer(tokenizer, tokenizerConfig);
            const options = { executionProviders: ["wasm"] };
            // This export has no KV cache or merged decoder. Feed the full prefix.
            this.encoderSession = await loadSession("onnx/encoder_model_quantized.onnx", options);
            this.decoderSession = await loadSession("onnx/decoder_model_quantized.onnx", options);
        } catch (error) {
            await this.dispose();
            throw error;
        }
    }

    async dispose() {
        await Promise.allSettled([this.encoderSession?.release(), this.decoderSession?.release()]);
    }

    async recognize(input, track, { isCancelled } = {}) {
        async function checkpoint() {
            if (!isCancelled) return;
            // Yield to worker messages so an edit can interrupt stale decoding.
            await new Promise(resolve => setTimeout(resolve, 0));
            if (isCancelled()) {
                const error = new Error("Recognition cancelled");
                error.name = "AbortError";
                throw error;
            }
        }
        await checkpoint();
        const pixels = track({ pixel_values: new ort.Tensor("float32", input.tensor, [1, 1, 448, 448]) });
        const encoded = track(await this.encoderSession.run(pixels));
        pixels.pixel_values.dispose();
        await checkpoint();
        const hidden = encoded.last_hidden_state;
        if (!hidden) throw new Error("TexTeller encoder did not return last_hidden_state");
        const ids = [this.startToken];
        for (let step = 0; step < 256; step++) {
            const feeds = track({
                input_ids: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]),
                encoder_hidden_states: hidden
            });
            const outputs = track(await this.decoderSession.run(feeds));
            feeds.input_ids.dispose();
            await checkpoint();
            const logits = outputs.logits;
            if (!logits) throw new Error("TexTeller decoder did not return logits");
            const size = logits.dims.at(-1);
            const offset = logits.data.length - size;
            let next = 0;
            for (let token = 1; token < size; token++) {
                if (logits.data[offset + token] > logits.data[offset + next]) next = token;
            }
            for (const tensor of Object.values(outputs)) tensor.dispose();
            if (next === this.endToken) {
                const latex = unwrapMathDelimiters(this.tokenizer.decode(ids.slice(1), { skip_special_tokens: true }));
                if (!latex) throw new Error("TexTeller returned an empty expression");
                return { latex };
            }
            ids.push(next);
        }
        throw new Error("TexTeller expression exceeded the 256-token recognition limit");
    }
}
