import { renderStroke } from "./stroke-renderer.js";

export const MODEL_SIZE = 448;
export const IMAGE_MEAN = 0.9545467;
export const IMAGE_STD = 0.15394445;
let rawCanvas;
let targetCanvas;

// TexTeller: crop white borders, grayscale, preserve aspect ratio, normalize,
// then pad the bottom/right with zero in normalized tensor space.
// https://github.com/OleehyO/TexTeller/blob/main/texteller/utils/image.py
export function preprocessStrokes(strokes) {
    strokes = strokes.filter(stroke => stroke.tool !== "highlighter" && stroke.points.length);
    if (!strokes.length) throw new Error("No equation strokes to recognize");
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const stroke of strokes) {
        const radius = Math.max(2, stroke.lineWidth || 2) / 2;
        for (const point of stroke.points) {
            minX = Math.min(minX, point.x - radius);
            minY = Math.min(minY, point.y - radius);
            maxX = Math.max(maxX, point.x + radius);
            maxY = Math.max(maxY, point.y + radius);
        }
    }
    const width = Math.ceil(maxX - minX) + 4;
    const height = Math.ceil(maxY - minY) + 4;
    rawCanvas ??= new OffscreenCanvas(width, height);
    rawCanvas.width = width;
    rawCanvas.height = height;
    const raw = rawCanvas.getContext("2d", { willReadFrequently: true });
    raw.fillStyle = "#ffffff";
    raw.fillRect(0, 0, width, height);
    for (const stroke of strokes) {
        renderStroke(raw, {
            ...stroke, color: "#000000", opacity: 1,
            lineWidth: Math.max(2, stroke.lineWidth || 2),
            points: stroke.points.map(point => ({ x: point.x - minX + 2, y: point.y - minY + 2 }))
        });
    }
    const data = raw.getImageData(0, 0, width, height).data;
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4] < 240) {
                left = Math.min(left, x); top = Math.min(top, y);
                right = Math.max(right, x); bottom = Math.max(bottom, y);
            }
        }
    }
    if (right < left) throw new Error("No visible equation strokes to recognize");
    const cropW = right - left + 1, cropH = bottom - top + 1;
    const scale = Math.min(447 / Math.min(cropW, cropH), 448 / Math.max(cropW, cropH));
    const contentW = Math.max(1, Math.floor(cropW * scale));
    const contentH = Math.max(1, Math.floor(cropH * scale));
    targetCanvas ??= new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE);
    const target = targetCanvas.getContext("2d", { willReadFrequently: true });
    target.fillStyle = "#ffffff";
    target.fillRect(0, 0, MODEL_SIZE, MODEL_SIZE);
    target.imageSmoothingEnabled = true;
    target.imageSmoothingQuality = "high";
    target.drawImage(rawCanvas, left, top, cropW, cropH, 0, 0, contentW, contentH);
    const resized = target.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data;
    const tensor = new Float32Array(MODEL_SIZE * MODEL_SIZE);
    for (let y = 0; y < contentH; y++) {
        for (let x = 0; x < contentW; x++) {
            const i = y * MODEL_SIZE + x;
            tensor[i] = (resized[i * 4] / 255 - IMAGE_MEAN) / IMAGE_STD;
        }
    }
    return { tensor, width: MODEL_SIZE, height: MODEL_SIZE, contentW, contentH };
}
