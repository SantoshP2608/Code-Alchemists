# ============================================================
#  recognizer.py — Ink-On CoMER model wrapper
#
#  This is the ML brain. It takes an image and returns a
#  LaTeX-like string of what it sees.
#
#  Adapted from: Code-Alchemists-main/recognize.py
#  Original source: https://github.com/kimseungdae/ink-on
#  Model: CoMER (ECCV 2022) — encoder-decoder with beam search
#
#  KEY DIFFERENCE from our old CNN approach:
#    Old: segment each char → classify one by one → stitch
#    New: feed the WHOLE image → model reads entire expression at once
#         (like how a human reads "7+3" without cutting it up)
#
#  MODIFICATIONS from original recognize.py:
#    1. Split into separate module (was standalone script)
#    2. Added accept_base64() to work with canvas data
#    3. Added accept_light_on_dark=True default (canvas is white on black)
#    4. Model loading happens once at startup (not per request)
#    5. Evaluator call removed — that's a separate module now
# ============================================================

import json
import base64
import io
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps


# --- Default model directory (relative to this file) ---
MODEL_DIR = Path(__file__).resolve().parent.parent / "ml" / "models"


class InkRecognizer:
    """
    Wraps the Ink-On CoMER ONNX model.
    Create ONE instance at app startup — reuse it for every request.
    Loading ONNX models is slow (~1 sec), prediction is fast (~200ms).
    """

    def __init__(self, model_dir: Path = MODEL_DIR):
        # --- Load vocabulary (maps token IDs ↔ symbol strings) ---
        with (model_dir / "vocab.json").open(encoding="utf-8") as f:
            self.vocab = json.load(f)

        # --- Load ONNX models (encoder + decoder) ---
        # Encoder: image → feature vectors (understands the shapes)
        # Decoder: feature vectors → token sequence (reads the math)
        self.encoder = ort.InferenceSession(
            str(model_dir / "encoder_int8.onnx"),
            providers=["CPUExecutionProvider"]
        )
        self.decoder = ort.InferenceSession(
            str(model_dir / "decoder_int8.onnx"),
            providers=["CPUExecutionProvider"]
        )

        # --- Build the allowed-symbols filter ---
        # We only want arithmetic symbols, not Greek letters, calculus, etc.
        # This makes the model focus on: digits, operators, parens, fractions
        arithmetic_symbols = [
            "<pad>", "<sos>", "<eos>",
            "(", ")", "+", "-", ".", "/",
            "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
            "=", "\\div", "\\frac", "\\pm", "\\times", "^", "_", "{", "}"
        ]
        self.allowed_ids = {
            self.vocab["word2idx"][s]
            for s in arithmetic_symbols
            if s in self.vocab["word2idx"]
        }

        self.sos = self.vocab["special_tokens"]["sos"]
        self.eos = self.vocab["special_tokens"]["eos"]
        self.eq_id = self.vocab["word2idx"]["="]
        self.specials = set(self.vocab["special_tokens"].values())

        print(f"[InkRecognizer] Models loaded from {model_dir}")

    # ---------------------------------------------------------
    # Preprocessing — prepare image for the encoder
    # ---------------------------------------------------------
    def _preprocess_pil(self, pil_image: Image.Image, light_on_dark: bool) -> tuple:
        """
        Prepare a PIL image for the encoder.
        Returns (pixels, mask) numpy arrays.

        What happens inside:
          1. Convert to grayscale
          2. Invert if needed (model expects white ink on black)
          3. Crop to ink bounding box + 16px margin
          4. Scale to fit 128px height, max 1024px width
          5. Pad to fixed canvas size (256 × N)
          6. Normalize pixels to 0.0-1.0
        """
        # Handle transparency (PNG from canvas may have alpha channel)
        rgba = pil_image.convert("RGBA")
        bg_color = (0, 0, 0, 255) if light_on_dark else (255, 255, 255, 255)
        image = Image.alpha_composite(Image.new("RGBA", rgba.size, bg_color), rgba)
        image = image.convert("L")  # grayscale

        # Ensure white-ink-on-black format
        ink = image if light_on_dark else ImageOps.invert(image)

        # Crop to just the ink (remove surrounding whitespace)
        # Threshold at 55 to find ink pixels
        bbox = ink.point(lambda p: 255 if p > 55 else 0).getbbox()
        if bbox is None:
            raise ValueError("No handwriting found in the image.")
        ink = ImageOps.expand(ink.crop(bbox), border=16, fill=0)

        # Scale to fit model input dimensions
        scale = min(128 / ink.height, 1024 / ink.width)
        width = max(1, round(ink.width * scale))
        height = max(1, round(ink.height * scale))
        ink = ink.resize((width, height), Image.Resampling.BILINEAR)

        # Place on a fixed-height canvas (256px tall, width multiple of 64)
        canvas_width = min(1024, max(128, ((width + 16 + 63) // 64) * 64))
        canvas = Image.new("L", (canvas_width, 256), 0)
        canvas.paste(ink, (0, 0))

        # Convert to numpy arrays
        pixels = np.asarray(canvas, dtype=np.float32) / 255.0
        mask = np.ones((1, 256, canvas_width), dtype=np.bool_)
        mask[:, :height, :width] = False  # False = "look here", True = "ignore"

        return pixels[None, None, :, :], mask  # add batch + channel dims

    # ---------------------------------------------------------
    # Beam Search Decoding — how the model "reads" the image
    # ---------------------------------------------------------
    def _beam_search(self, features, feature_mask, beam_width=3) -> str:
        """
        Beam search: explore multiple possible readings in parallel,
        keep the top-k most likely ones, stop when all finish.

        Like autocomplete that tries 3 suggestions at once and
        picks the best overall sentence.

        Returns the raw LaTeX string (e.g., "1 + 2")
        """
        beams = [(0.0, [self.sos], False)]  # (score, token_ids, finished)

        for _ in range(50):  # max 50 tokens
            candidates = []
            for score, ids, finished in beams:
                if finished:
                    candidates.append((score, ids, True))
                    continue

                # Run decoder: given what we've decoded so far, what's next?
                logits = self.decoder.run(["logits"], {
                    "encoder_features": features,
                    "encoder_mask": feature_mask,
                    "input_ids": np.array([ids], dtype=np.int64),
                })[0][0, -1].astype(np.float64)

                # Convert logits to log-probabilities (softmax in log space)
                shifted = logits - logits.max()
                log_probs = shifted - np.log(np.exp(shifted).sum())

                # Mask out non-arithmetic symbols
                for index in range(len(log_probs)):
                    if index not in self.allowed_ids:
                        log_probs[index] = -np.inf

                # Try the top candidates
                for token in np.argsort(log_probs)[::-1][:beam_width * 2]:
                    token = int(token)
                    if not np.isfinite(log_probs[token]):
                        continue
                    new_score = score + float(log_probs[token])
                    if token == self.eos:
                        candidates.append((new_score, ids, True))
                    elif token == self.eq_id:
                        # "=" means end of expression
                        candidates.append((new_score, ids + [token], True))
                    else:
                        candidates.append((new_score, ids + [token], False))

            # Keep top-k beams (normalized by length to avoid short-sequence bias)
            beams = sorted(
                candidates, key=lambda b: b[0] / len(b[1]), reverse=True
            )[:beam_width]

            if all(b[2] for b in beams):
                break

        # Pick the best completed beam
        completed = [b for b in beams if b[2]]
        best = max(completed or beams, key=lambda b: b[0] / len(b[1]))

        # Convert token IDs back to symbol strings
        return " ".join(
            self.vocab["idx2word"][str(i)]
            for i in best[1]
            if i not in self.specials
        )

    # ---------------------------------------------------------
    # Public methods
    # ---------------------------------------------------------
    def recognize_from_pil(self, pil_image: Image.Image, light_on_dark=False) -> str:
        """
        Recognize math from a PIL Image.
        Returns raw LaTeX string like "1 + 2" or "\\frac { 3 } { 4 }"
        """
        pixels, mask = self._preprocess_pil(pil_image, light_on_dark)
        features, feature_mask = self.encoder.run(
            ["encoder_features", "encoder_mask"],
            {"pixel_values": pixels, "pixel_mask": mask},
        )
        return self._beam_search(features, feature_mask)

    def recognize_from_base64(self, base64_string: str, light_on_dark=True) -> str:
        """
        Recognize math from a base64-encoded image (from canvas).
        Canvas sends white-on-black by default, so light_on_dark=True.

        Returns raw LaTeX string.
        """
        # Strip the data URL header if present
        if "," in base64_string:
            base64_string = base64_string.split(",")[1]

        img_bytes = base64.b64decode(base64_string)
        pil_image = Image.open(io.BytesIO(img_bytes))
        return self.recognize_from_pil(pil_image, light_on_dark)

    def recognize_from_file(self, image_path: str, light_on_dark=False) -> str:
        """
        Recognize math from a file path. For testing.
        """
        pil_image = ImageOps.exif_transpose(Image.open(image_path))
        return self.recognize_from_pil(pil_image, light_on_dark)
