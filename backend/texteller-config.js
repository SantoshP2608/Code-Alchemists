export const MODEL_ID = "onnx-community/TexTeller-ONNX";
export const MODEL_REVISION = "9727784d91d7f8437dc7140941c4335284ce075e";
export const MODEL_ASSET_PATH = `models/texteller/${MODEL_REVISION}`;
export const MODEL_REMOTE_URL = `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}`;
export const MODEL_FILES = [
    "config.json", "tokenizer.json", "tokenizer_config.json",
    "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_quantized.onnx"
];
