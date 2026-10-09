// Release every tracked tensor, including intermediate outputs on error paths.
export async function recognizeWithCleanup(engine, input, options) {
    const tensors = new Set();
    let recognitionFailed = false;
    const track = values => {
        for (const tensor of Object.values(values)) {
            if (typeof tensor?.dispose === "function") tensors.add(tensor);
        }
        return values;
    };
    try {
        return await engine.recognize(input, track, options);
    } catch (error) {
        recognitionFailed = true;
        throw error;
    } finally {
        let cleanupError;
        for (const tensor of tensors) {
            try {
                if (tensor.location !== "none") tensor.dispose();
            } catch (error) {
                cleanupError ||= error;
            }
        }
        tensors.clear();
        if (cleanupError && !recognitionFailed) throw cleanupError;
    }
}
