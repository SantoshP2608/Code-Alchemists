import assert from "node:assert/strict";
import test from "node:test";
import { renderStroke } from "../backend/stroke-renderer.js";
import { preprocessStrokes } from "../backend/preprocessing.js";

function recordingContext() {
    const paints = [];
    const stack = [];
    const keys = ["strokeStyle", "fillStyle", "globalAlpha", "lineWidth", "lineCap", "lineJoin"];
    const context = { globalAlpha: 1, strokeStyle: "original", fillStyle: "original", lineWidth: 5,
        save() { stack.push(Object.fromEntries(keys.map(key => [key, this[key]]))); },
        restore() { Object.assign(this, stack.pop()); },
        beginPath() {}, arc() {}, moveTo() {}, quadraticCurveTo() {}, lineTo() {},
        fill() { paints.push({ type: "fill", colour: this.fillStyle, opacity: this.globalAlpha }); },
        stroke() { paints.push({ type: "stroke", colour: this.strokeStyle, opacity: this.globalAlpha }); }
    };
    return { context, paints };
}

test("marker paths paint once at uniform opacity and never leak styling to pencil strokes", () => {
    const { context, paints } = recordingContext();
    renderStroke(context, { tool: "highlighter", color: "#f7d86a", opacity: 0.28, lineWidth: 24,
        points: [{ x: 10, y: 20 }, { x: 50, y: 20 }, { x: 10, y: 20 }] });
    assert.deepEqual(paints, [{ type: "stroke", colour: "#f7d86a", opacity: 0.28 }]);
    assert.equal(context.globalAlpha, 1);
    assert.equal(context.strokeStyle, "original");
    renderStroke(context, { tool: "pencil", color: "#7ec8ff", opacity: 1, lineWidth: 5,
        points: [{ x: 10, y: 20 }, { x: 50, y: 20 }] });
    assert.ok(paints.slice(1).every(paint => paint.colour === "#7ec8ff" && paint.opacity === 1));
});

test("marker dots are translucent single fills and legacy strokes retain the light theme's dark ink", () => {
    const { context, paints } = recordingContext();
    renderStroke(context, { tool: "highlighter", color: "#ff9fbe", opacity: 0.28,
        lineWidth: 24, points: [{ x: 10, y: 20 }] });
    assert.deepEqual(paints, [{ type: "fill", colour: "#ff9fbe", opacity: 0.28 }]);
    renderStroke(context, { lineWidth: 5, points: [{ x: 10, y: 20 }] });
    assert.deepEqual(paints[1], { type: "fill", colour: "#252737", opacity: 1 });
});

test("preprocessing normalizes pencil colours and excludes marker ink from model bounds", () => {
    const previousCanvas = globalThis.OffscreenCanvas;
    const canvases = [];
    globalThis.OffscreenCanvas = class {
        constructor(width, height) {
            this.width = width; this.height = height;
            this.paints = [];
            const paints = this.paints;
            const canvas = this;
            this.context = {
                fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
                arc() {}, quadraticCurveTo() {}, drawImage() {},
                fill() { paints.push(this.fillStyle); },
                stroke() { paints.push(this.strokeStyle); },
                getImageData() { return { data: new Uint8ClampedArray(canvas.width * canvas.height * 4) }; }
            };
            canvases.push(this);
        }
        getContext() { return this.context; }
    };
    try {
        for (const colour of ["#7ec8ff", "#85e0ac", "#ff9fbe"]) {
            const input = preprocessStrokes([
                { tool: "pencil", color: colour, lineWidth: 5, points: [{ x: 10, y: 20 }, { x: 30, y: 40 }] },
                { tool: "highlighter", color: "#f7d86a", opacity: 0.28,
                    lineWidth: 60, points: [{ x: 800, y: 300 }, { x: 890, y: 395 }] }
            ]);
            assert.equal(canvases[0].width, 52);
            assert.equal(canvases[0].height, 52);
            assert.equal(canvases[0].paints.at(-1), "#ffffff");
            assert.equal(input.height, 256);
            assert.equal(input.tensor.length, input.width * input.height);
        }
        assert.equal(canvases[0].paints.length, 3);
    } finally {
        if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
        else globalThis.OffscreenCanvas = previousCanvas;
    }
});

test("preprocessing rejects annotation-only requests before allocating a canvas", () => {
    assert.throws(() => preprocessStrokes([{ tool: "highlighter", lineWidth: 24,
        points: [{ x: 10, y: 20 }] }]), /No equation strokes/);
});
