"""Recognize one handwritten math expression from a local image.

Uses ink-on's CoMER ONNX model interface and image conventions.
Source: https://github.com/kimseungdae/ink-on
This image adapter is a standalone test, not the browser application.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps


def preprocess(path, light_on_dark=False):
    # Composite transparent PNGs onto the expected background.
    rgba = ImageOps.exif_transpose(Image.open(path)).convert("RGBA")
    background = (0, 0, 0, 255) if light_on_dark else (255, 255, 255, 255)
    image = Image.alpha_composite(Image.new("RGBA", rgba.size, background), rgba)
    image = image.convert("L")
    ink = image if light_on_dark else ImageOps.invert(image)
    # Find ink, crop away surrounding paper, then restore a 16px margin.
    bbox = ink.point(lambda p: 255 if p > 55 else 0).getbbox()
    if bbox is None:
        raise ValueError("No handwriting found in the image.")
    ink = ImageOps.expand(ink.crop(bbox), border=16, fill=0)
    scale = min(128 / ink.height, 1024 / ink.width)
    width = max(1, round(ink.width * scale))
    height = max(1, round(ink.height * scale))
    ink = ink.resize((width, height), Image.Resampling.BILINEAR)
    canvas_width = min(1024, max(128, ((width + 16 + 63) // 64) * 64))
    canvas = Image.new("L", (canvas_width, 256), 0)
    canvas.paste(ink, (0, 0))
    pixels = np.asarray(canvas, dtype=np.float32) / 255.0
    mask = np.ones((1, 256, canvas_width), dtype=np.bool_)
    mask[:, :height, :width] = False
    return pixels[None, None, :, :], mask


def recognize(image_path, model_dir, light_on_dark=False, beam_width=3):
    with (model_dir / "vocab.json").open(encoding="utf-8") as file:
        vocab = json.load(file)
    encoder = ort.InferenceSession(str(model_dir / "encoder_int8.onnx"),
                                   providers=["CPUExecutionProvider"])
    decoder = ort.InferenceSession(str(model_dir / "decoder_int8.onnx"),
                                   providers=["CPUExecutionProvider"])
    pixels, mask = preprocess(image_path, light_on_dark)
    features, feature_mask = encoder.run(
        ["encoder_features", "encoder_mask"],
        {"pixel_values": pixels, "pixel_mask": mask},
    )
    sos = vocab["special_tokens"]["sos"]
    eos = vocab["special_tokens"]["eos"]
    # Match ink-on's arithmetic-focused Number mode vocabulary.
    symbols = ["<pad>", "<sos>", "<eos>", "(", ")", "+", "-", ".", "/",
               *list("0123456789"), "=", "\\div", "\\frac", "\\pm",
               "\\times", "^", "_", "{", "}"]
    allowed = {vocab["word2idx"][s] for s in symbols if s in vocab["word2idx"]}
    beams = [(0.0, [sos], False)]
    for _ in range(50):
        candidates = []
        for score, ids, finished in beams:
            if finished:
                candidates.append((score, ids, True))
                continue
            logits = decoder.run(["logits"], {
                "encoder_features": features,
                "encoder_mask": feature_mask,
                "input_ids": np.array([ids], dtype=np.int64),
            })[0][0, -1].astype(np.float64)
            shifted = logits - logits.max()
            log_probs = shifted - np.log(np.exp(shifted).sum())
            for index in range(len(log_probs)):
                if index not in allowed:
                    log_probs[index] = -np.inf
            for token in np.argsort(log_probs)[::-1][:beam_width * 2]:
                token = int(token)
                if not np.isfinite(log_probs[token]):
                    continue
                new_score = score + float(log_probs[token])
                if token == eos:
                    candidates.append((new_score, ids, True))
                elif token == vocab["word2idx"]["="]:
                    candidates.append((new_score, ids + [token], True))
                else:
                    candidates.append((new_score, ids + [token], False))
        beams = sorted(candidates, key=lambda b: b[0] / len(b[1]), reverse=True)[:beam_width]
        if all(b[2] for b in beams):
            break
    completed = [b for b in beams if b[2]]
    best = max(completed or beams, key=lambda b: b[0] / len(b[1]))
    specials = set(vocab["special_tokens"].values())
    return " ".join(vocab["idx2word"][str(i)] for i in best[1] if i not in specials)


def main():
    parser = argparse.ArgumentParser(description="Image -> handwritten math LaTeX string")
    parser.add_argument("image", type=Path, help="A PNG or JPG containing one equation")
    parser.add_argument("--models", type=Path, default=Path(__file__).resolve().parent / "models")
    parser.add_argument("--light-on-dark", action="store_true", help="For white ink on black paper")
    args = parser.parse_args()
    try:
        latex = recognize(args.image, args.models, args.light_on_dark)

        expression = (
            latex.replace(r"\times", "*")
                .replace(r"\div", "/")
                .replace(" ", "")
        )
        print(expression)
    except Exception as error:
        print(f"Recognition failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
