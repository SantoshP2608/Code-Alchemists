// ink-on 0.1.0 does not dispose all session outputs or clean up every error path.
// Track session I/O for one recognition, without changing its decoding logic.
export async function recognizeWithCleanup(engine, input, vocab, mode) {
    await engine.init();
    const tensors = new Set();
    const runs = [];
    let recognitionFailed = false;
    function track(values) {
        for (const tensor of Object.values(values)) {
            if (typeof tensor?.dispose === "function") tensors.add(tensor);
        }
    }
    try {
        for (const session of [engine.encoderSession, engine.decoderSession]) {
            const run = session.run;
            runs.push({ session, run });
            session.run = async function (feeds, ...args) {
                track(feeds);
                const outputs = await run.call(session, feeds, ...args);
                track(outputs);
                return outputs;
            };
        }
        return await engine.recognize(input, vocab, mode);
    } catch (error) {
        recognitionFailed = true;
        throw error;
    } finally {
        for (const { session, run } of runs) session.run = run;
        let cleanupError;
        for (const tensor of tensors) {
            try {
                // ONNX Runtime exposes 'none' after a tensor is disposed.
                if (tensor.location !== "none") tensor.dispose();
            } catch (error) {
                cleanupError ||= error;
            }
        }
        tensors.clear();
        if (cleanupError && !recognitionFailed) throw cleanupError;
    }
}
