import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import createEvaluator from "../backend/evaluate.js";
import { formatLatex } from "../backend/formatter.js";

const source = await readFile(new URL("../backend/app.js", import.meta.url), "utf8");

// Exercise the real drawing controller with deterministic canvas, timer and worker
// boundaries. No model download or timing-dependent inference is needed here.
async function setup({
    ready = true, platform = "Win32",
    loadEvaluator = async () => ({ calculate: value => `answer:${value}` }),
    format = value => value
} = {}) {
    const timers = new Map();
    let timerId = 0;
    let resize;
    let worker;
    const mediaQueries = [];
    let observerDisconnected = false;
    function element() {
        const listeners = new Map();
        const captures = new Set();
        const calls = [];
        const attributes = new Map();
        const classes = new Set();
        const context = Object.fromEntries([
            "beginPath", "arc", "fill", "moveTo", "quadraticCurveTo",
            "lineTo", "stroke", "setTransform", "clearRect", "putImageData", "save", "restore"
        ].map(name => [name, (...args) => calls.push({ name, args })]));
        return {
            textContent: "Loading model...", disabled: false,
            children: [], hidden: false,
            append(...children) { this.children.push(...children); },
            replaceChildren(...children) { this.children = children; },
            value: "", style: {},
            setAttribute: (name, value) => attributes.set(name, value),
            getAttribute: name => attributes.get(name),
            classList: {
                toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
                contains: name => classes.has(name)
            },
            width: 900, height: 400, calls, context,
            rectangle: { left: 0, top: 0, width: 900, height: 400 },
            getContext: () => context,
            getBoundingClientRect() { return this.rectangle; },
            setPointerCapture: id => captures.add(id),
            hasPointerCapture: id => captures.has(id),
            releasePointerCapture(id) {
                captures.delete(id);
                this.emit("lostpointercapture", { pointerId: id });
            },
            addEventListener: (type, handler) => listeners.set(type, handler),
            removeEventListener(type, handler) {
                if (listeners.get(type) === handler) listeners.delete(type);
            },
            listenerCount: () => listeners.size,
            emit(type, fields = {}) {
                const event = {
                    type, pointerId: 1, button: 0, target: this,
                    defaultPrevented: false,
                    preventDefault() { this.defaultPrevented = true; }, ...fields
                };
                listeners.get(type)?.(event);
                return event;
            }
        };
    }
    const elements = Object.fromEntries([
        "canvas", "answer", "preview", "undoBtn", "redoBtn", "clearBtn",
        "pencilBtn", "eraserBtn", "eraserMode", "sizeSlider", "sizeValue",
        "calculationHistory", "historyEmpty", "historyCount", "canvasAnswer", "canvasWrapper"
    ].map(id => [id, element()]));
    elements.historyCount.textContent = "0 / 10";
    elements.canvasAnswer.hidden = true;
    elements.canvasAnswer.rectangle = { left: 0, top: 0, width: 60, height: 32 };
    const document = {
        ...element(), getElementById: id => elements[id], createElement: () => element()
    };
    const browserWindow = {
        ...element(), devicePixelRatio: 2,
        matchMedia(query) {
            const media = { ...element(), media: query };
            mediaQueries.push(media);
            return media;
        }
    };
    const context = vm.createContext({
        document, navigator: { platform },
        window: browserWindow, URL,
        console: { log() {} },
        setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
        clearTimeout(id) { timers.delete(id); },
        ImageData: class { constructor(pixels, width, height) {
            Object.assign(this, { pixels, width, height });
        } },
        ResizeObserver: class {
            constructor(callback) { resize = callback; }
            observe() {}
            disconnect() { observerDisconnected = true; }
        },
        Worker: class {
            constructor() { worker = this; this.requests = []; }
            postMessage(message) { this.requests.push(structuredClone(message)); }
            terminate() { this.terminated = true; }
        }
    });
    const app = new vm.SourceTextModule(source, {
        context, initializeImportMeta(meta) { meta.url = "file:///backend/app.js"; }
    });
    const evaluator = new vm.SyntheticModule(["default"], function () {
        this.setExport("default", loadEvaluator);
    }, { context });
    const formatter = new vm.SyntheticModule(["formatLatex"], function () {
        this.setExport("formatLatex", format);
    }, { context });
    await app.link(name => name === "./evaluate.js" ? evaluator : formatter);
    await app.evaluate();
    await Promise.resolve();
    function message(data) { worker.onmessage({ data }); }
    if (ready) message({ type: "ready" });
    return {
        ...elements, worker, message, resize: () => resize(),
        browserWindow, mediaQueries, observerDisconnected: () => observerDisconnected,
        timerCount: () => timers.size,
        settle: () => new Promise(resolve => setImmediate(resolve)),
        key(key, fields = {}) { return document.emit("keydown", { key, ...fields }); },
        tick() {
            const callbacks = [...timers.values()];
            timers.clear();
            callbacks.forEach(callback => callback());
        },
        stroke(x, dot = false) {
            elements.canvas.emit("pointerdown", { clientX: x, clientY: 20 });
            if (!dot) elements.canvas.emit("pointermove", { clientX: x + 10, clientY: 30 });
            elements.canvas.emit("pointerup", { clientX: dot ? x : x + 20, clientY: dot ? 20 : 40 });
        }
    };
}

function historyRows(app) {
    return app.calculationHistory.children.map(row => row.children.map(child => child.textContent));
}

function drawLine(app, x1, y1, x2, y2) {
    app.canvas.emit("pointerdown", { clientX: x1, clientY: y1 });
    app.canvas.emit("pointerup", { clientX: x2, clientY: y2 });
}

test("pixel-density changes preserve logical ink and replace the old density listener", async () => {
    const app = await setup();
    app.stroke(10);
    assert.equal(app.canvas.width, 1800);
    for (const ratio of [1, 1.25, 1.5, 2, 3]) {
        const oldQuery = app.mediaQueries.at(-1);
        app.browserWindow.devicePixelRatio = ratio;
        oldQuery.emit("change");
        assert.equal(oldQuery.listenerCount(), 0);
        assert.equal(app.mediaQueries.at(-1).listenerCount(), 1);
        assert.equal(app.canvas.width, Math.round(900 * ratio));
        assert.equal(app.canvas.height, Math.round(400 * ratio));
        assert.deepEqual(app.canvas.calls.filter(call => call.name === "setTransform").at(-1).args,
            [ratio, 0, 0, ratio, 0, 0]);
    }
    app.tick();
    assert.deepEqual(app.worker.requests[0].strokes[0].points,
        [{ x: 10, y: 20 }, { x: 20, y: 30 }, { x: 30, y: 40 }]);
});

test("page teardown releases the worker, observer, density listener and debounce timer", async () => {
    const app = await setup();
    app.stroke(10);
    app.browserWindow.emit("pagehide", { persisted: true });
    assert.equal(app.worker.terminated, undefined);
    assert.equal(app.observerDisconnected(), false);
    assert.equal(app.mediaQueries.at(-1).listenerCount(), 1);
    assert.equal(app.timerCount(), 1);
    app.browserWindow.emit("pagehide", { persisted: false });
    assert.equal(app.worker.terminated, true);
    assert.equal(app.observerDisconnected(), true);
    assert.equal(app.mediaQueries.at(-1).listenerCount(), 0);
    assert.equal(app.timerCount(), 0);
    assert.equal(app.worker.onmessage, null);
    app.tick();
    assert.equal(app.worker.requests.length, 0);
});

test("same-size resize callbacks reuse the canvas bitmap and still redraw the ink", async () => {
    const app = await setup();
    app.stroke(10);
    let width = app.canvas.width;
    let height = app.canvas.height;
    let writes = 0;
    Object.defineProperty(app.canvas, "width", {
        get: () => width, set(value) { width = value; writes++; }
    });
    Object.defineProperty(app.canvas, "height", {
        get: () => height, set(value) { height = value; writes++; }
    });
    app.canvas.calls.length = 0;
    for (let i = 0; i < 10; i++) app.resize();
    assert.equal(writes, 0);
    assert.equal(app.canvas.calls.filter(call => call.name === "clearRect").length, 10);
    assert.equal(app.canvas.calls.filter(call => call.name === "arc").length, 10);
    app.canvas.rectangle.width = 450;
    app.canvas.rectangle.height = 200;
    app.resize();
    assert.equal(writes, 2);
    assert.equal(width, 900);
    assert.equal(height, 400);
});

test("drawing history keeps only 100 actions without dropping existing ink", async () => {
    const app = await setup();
    for (let i = 0; i < 250; i++) app.stroke(i, true);
    let undoCount = 0;
    while (!app.undoBtn.disabled) {
        app.undoBtn.emit("click");
        if (++undoCount > 250) throw new Error("Undo did not reach its boundary");
    }
    assert.equal(undoCount, 100);
    app.tick();
    assert.equal(app.worker.requests.at(-1).strokes.length, 150);
    const first = app.worker.requests.at(-1);
    app.message({ type: "result", version: first.version, latex: "1=" });
    let redoCount = 0;
    while (!app.redoBtn.disabled) {
        app.redoBtn.emit("click");
        if (++redoCount > 250) throw new Error("Redo did not reach its boundary");
    }
    assert.equal(redoCount, 100);
    app.clearBtn.emit("click");
    app.undoBtn.emit("click");
    app.tick();
    assert.equal(app.worker.requests.at(-1).strokes.length, 250);
    assert.equal(app.timerCount(), 0);
});

test("rapid history changes keep one debounce and one in-flight recognition", async () => {
    const app = await setup();
    app.stroke(10);
    app.tick();
    const first = app.worker.requests[0];
    for (let i = 0; i < 1000; i++) {
        app.undoBtn.emit("click");
        app.redoBtn.emit("click");
        assert.equal(app.timerCount(), 1);
        assert.equal(app.worker.requests.length, 1);
    }
    app.tick();
    app.message({ type: "result", version: first.version, latex: "old=" });
    app.tick();
    assert.equal(app.worker.requests.length, 2);
    assert.equal(app.timerCount(), 0);
});

test("answers sit beside the equals ink and follow resize without entering stroke history", async () => {
    const app = await setup({ loadEvaluator: async () => ({ calculate: () => "1" }) });
    drawLine(app, 100, 100, 100, 200);
    drawLine(app, 200, 140, 240, 140);
    drawLine(app, 200, 160, 240, 160);
    app.tick();
    const request = app.worker.requests.at(-1);
    app.message({ type: "result", version: request.version, latex: "1=" });
    assert.equal(app.canvasAnswer.textContent, "1");
    assert.equal(app.canvasAnswer.hidden, false);
    const left = parseFloat(app.canvasAnswer.style.left);
    const top = parseFloat(app.canvasAnswer.style.top);
    assert.ok(left > 242.5 && left + 60 < 900);
    assert.ok(top < 140 && top + 32 > 160);
    assert.equal(app.canvasWrapper.style.paddingBottom, "0px");
    app.canvas.rectangle = { left: 0, top: 0, width: 450, height: 200 };
    app.resize();
    assert.ok(parseFloat(app.canvasAnswer.style.left) < left);
    assert.ok(parseFloat(app.canvasAnswer.style.left) + 60 <= 450);
    assert.equal(app.worker.requests.length, 1);
    assert.equal(app.historyCount.textContent, "1 / 10");
    app.clearBtn.emit("click");
    assert.equal(app.canvasAnswer.hidden, true);
    assert.equal(app.canvasAnswer.textContent, "");
    app.undoBtn.emit("click");
    assert.equal(app.canvasAnswer.hidden, true);
    app.tick();
    const restored = app.worker.requests.at(-1);
    assert.deepEqual(restored.strokes, request.strokes); // Only the three ink strokes.
    app.message({ type: "result", version: restored.version, latex: "1=" });
    assert.equal(app.canvasAnswer.hidden, false);
});

test("answers fall below ink near the right edge and gain space at the bottom", async () => {
    const app = await setup({ loadEvaluator: async () => ({ calculate: () => "123456789" }) });
    drawLine(app, 800, 350, 800, 395);
    drawLine(app, 850, 360, 890, 360);
    drawLine(app, 850, 380, 890, 380);
    app.tick();
    app.message({ type: "result", version: app.worker.requests.at(-1).version, latex: "123456789=" });
    assert.equal(app.canvasAnswer.hidden, false);
    assert.ok(parseFloat(app.canvasAnswer.style.top) > 397.5);
    assert.ok(parseFloat(app.canvasAnswer.style.left) + 60 <= 892);
    assert.ok(parseFloat(app.canvasWrapper.style.paddingBottom) > 0);
    assert.equal(app.canvas.height, 800); // The drawable canvas was not extended.
    app.canvasAnswer.rectangle.width = 880;
    app.canvasAnswer.rectangle.height = 100;
    app.resize();
    assert.ok(parseFloat(app.canvasAnswer.style.left) >= 8);
    assert.ok(parseFloat(app.canvasAnswer.style.left) + 880 <= 892);
    app.clearBtn.emit("click");
    assert.equal(app.canvasWrapper.style.paddingBottom, "0px");
    assert.equal(app.canvasAnswer.hidden, true);
});

test("edits, errors and outdated replies cannot leave an old answer on the drawing", async () => {
    const app = await setup({
        format: formatLatex,
        loadEvaluator: async () => ({ calculate: expression => expression === "2+=" ? "Error: Missing operand" : "1" })
    });
    app.stroke(10);
    app.tick();
    const first = app.worker.requests.at(-1);
    app.message({ type: "result", version: first.version, latex: "1=" });
    assert.equal(app.canvasAnswer.hidden, false);
    app.canvas.emit("pointerdown", { clientX: 40, clientY: 40 });
    assert.equal(app.canvasAnswer.hidden, true);
    app.message({ type: "result", version: first.version, latex: "old=" });
    assert.equal(app.canvasAnswer.hidden, true);
    app.canvas.emit("pointerup", { clientX: 40, clientY: 40 });
    for (const latex of ["2+=", "x=", "2+3"]) {
        app.tick();
        app.message({ type: "result", version: app.worker.requests.at(-1).version, latex });
        assert.equal(app.canvasAnswer.hidden, true);
        app.stroke(50);
    }
    app.tick();
    app.message({ type: "result", version: app.worker.requests.at(-1).version, latex: "1=" });
    assert.equal(app.canvasAnswer.hidden, false);
    app.worker.onerror({ message: "Worker stopped" });
    assert.equal(app.canvasAnswer.hidden, true);
});

test("calculation history pairs equations and answers, keeping only the latest 10", async () => {
    const app = await setup({
        format: formatLatex,
        loadEvaluator: async () => ({ calculate: expression => String(Number(expression.split("+")[0]) * 2) })
    });
    assert.equal(app.historyEmpty.hidden, false);
    for (let i = 1; i <= 12; i++) {
        app.stroke(i, true);
        app.tick();
        const { version } = app.worker.requests.at(-1);
        app.message({ type: "result", version, latex: `${i}+${i}=` });
    }
    assert.deepEqual(historyRows(app), Array.from({ length: 10 }, (_, index) => {
        const value = 12 - index;
        return [`${value}+${value} = `, String(value * 2)];
    }));
    assert.equal(app.historyCount.textContent, "10 / 10");
    assert.equal(app.historyEmpty.hidden, true);
    app.clearBtn.emit("click");
    app.undoBtn.emit("click");
    app.resize();
    assert.equal(app.calculationHistory.children.length, 10);
    app.tick();
    app.message({ type: "result", version: app.worker.requests.at(-1).version, latex: "12+12=" });
    assert.deepEqual(historyRows(app).slice(0, 2), [["12+12 = ", "24"], ["12+12 = ", "24"]]);
    assert.equal(app.calculationHistory.children.length, 10);
    const fresh = await setup();
    assert.equal(fresh.calculationHistory.children.length, 0);
});

test("incomplete, invalid and failed calculations do not enter calculation history", async () => {
    const app = await setup({
        format: formatLatex,
        loadEvaluator: async () => ({ calculate: expression => {
            if (expression === "7+=") return "Error: Missing operand";
            if (expression === "8=") throw new Error("Calculation failed");
            if (expression === "9=") return "Waiting";
            return "Undefined";
        } })
    });
    for (const latex of ["7", "x=", "7+=", "8=", "9="]) {
        app.stroke(10, true);
        app.tick();
        app.message({ type: "result", version: app.worker.requests.at(-1).version, latex });
        assert.deepEqual(historyRows(app), []);
    }
    app.stroke(10, true);
    app.tick();
    app.message({ type: "error", version: app.worker.requests.at(-1).version, message: "Inference failed" });
    assert.deepEqual(historyRows(app), []);
    assert.equal(app.historyEmpty.hidden, false);
    app.stroke(10, true);
    app.tick();
    app.message({ type: "result", version: app.worker.requests.at(-1).version, latex: "1/0=" });
    assert.deepEqual(historyRows(app), [["1/0 = ", "Undefined"]]);
});

test("outdated and duplicate worker replies cannot add calculation history entries", async () => {
    const app = await setup();
    app.stroke(10);
    app.tick();
    const old = app.worker.requests.at(-1);
    app.clearBtn.emit("click");
    app.message({ type: "result", version: old.version, latex: "stale=" });
    assert.deepEqual(historyRows(app), []);
    app.undoBtn.emit("click");
    app.tick();
    const current = app.worker.requests.at(-1);
    app.message({ type: "result", version: current.version, latex: "2+3=" });
    app.message({ type: "result", version: current.version, latex: "duplicate=" });
    app.message({ type: "result", version: old.version, latex: "stale=" });
    assert.deepEqual(historyRows(app), [["2+3 = ", "answer:2+3="]]);
    app.undoBtn.emit("click");
    assert.deepEqual(historyRows(app), [["2+3 = ", "answer:2+3="]]);
});

test("completed strokes and dots undo and redo in order; active strokes disable controls", async () => {
    const app = await setup();
    assert.equal(app.undoBtn.disabled, true);
    assert.equal(app.redoBtn.disabled, true);
    app.stroke(10);
    app.canvas.emit("pointerdown", { clientX: 50, clientY: 20 });
    assert.equal(app.undoBtn.disabled, true);
    assert.equal(app.redoBtn.disabled, true);
    app.undoBtn.emit("click"); // Guard even against a programmatic click.
    app.canvas.emit("pointerup", { clientX: 50, clientY: 20 });
    app.undoBtn.emit("click");
    app.undoBtn.emit("click");
    assert.equal(app.undoBtn.disabled, true);
    assert.equal(app.redoBtn.disabled, false);
    app.tick();
    assert.equal(app.worker.requests.length, 0);
    app.redoBtn.emit("click");
    app.redoBtn.emit("click");
    app.redoBtn.emit("click"); // Empty redo is harmless.
    assert.equal(app.redoBtn.disabled, true);
    app.tick();
    const [line, dot] = app.worker.requests[0].strokes;
    assert.equal(line.points[0].x, 10);
    assert.deepEqual(dot.points, [{ x: 50, y: 20 }]);
});

test("a newly completed stroke discards redo, including a single dot", async () => {
    const app = await setup();
    app.stroke(10);
    app.stroke(50);
    app.undoBtn.emit("click");
    app.stroke(100, true);
    assert.equal(app.redoBtn.disabled, true);
    app.redoBtn.emit("click");
    app.tick();
    assert.deepEqual(app.worker.requests[0].strokes.map(s => s.points[0].x), [10, 100]);
});

test("history changes clear answers and previews and ignore stale worker messages", async () => {
    const app = await setup();
    app.stroke(10);
    app.stroke(50);
    app.tick();
    const { version } = app.worker.requests[0];
    app.message({ type: "result", version, latex: "2+3=" });
    assert.equal(app.answer.textContent, "answer:2+3=");
    app.preview.calls.length = 0;
    app.undoBtn.emit("click");
    assert.equal(app.answer.textContent, "");
    assert.equal(app.preview.calls.at(-1).name, "clearRect");
    app.message({ type: "preview", version, width: 1, height: 1, pixels: new Uint8ClampedArray(4) });
    app.message({ type: "result", version, latex: "old" });
    assert.equal(app.answer.textContent, "");
    assert.equal(app.preview.calls.some(c => c.name === "putImageData"), false);
    app.tick();
    assert.equal(app.worker.requests.at(-1).strokes.length, 1);
});

test("busy recognition retains the latest history request after its timer expires", async () => {
    const app = await setup();
    app.stroke(10);
    app.stroke(50);
    app.tick();
    const first = app.worker.requests[0];
    app.undoBtn.emit("click");
    app.redoBtn.emit("click");
    app.undoBtn.emit("click");
    app.tick(); // Worker is busy when the latest debounce timer fires.
    assert.equal(app.worker.requests.length, 1);
    app.message({ type: "error", version: first.version, message: "outdated error" });
    assert.equal(app.answer.textContent, "");
    app.tick();
    assert.equal(app.worker.requests.length, 2);
    const latest = app.worker.requests[1];
    assert.equal(latest.strokes.length, 1);
    assert.ok(latest.version > first.version);
    app.message({ type: "result", version: latest.version, latex: "1=" });
    assert.equal(app.answer.textContent, "answer:1=");
});

test("undo to empty and Clear stay empty after in-flight recognition", async () => {
    for (const action of ["undoBtn", "clearBtn"]) {
        const app = await setup();
        app.stroke(10);
        app.tick();
        const { version } = app.worker.requests[0];
        app[action].emit("click");
        app.tick();
        app.message({ type: "result", version, latex: "outdated" });
        app.tick();
        assert.equal(app.answer.textContent, "");
        assert.equal(app.worker.requests.length, 1);
        assert.equal(app.undoBtn.disabled, action === "undoBtn");
        assert.equal(app.redoBtn.disabled, action === "clearBtn");
    }
});

test("Clear during drawing preserves the partial stroke and ignores later pointer events", async () => {
    const app = await setup();
    app.stroke(10);
    app.stroke(50);
    app.undoBtn.emit("click");
    app.canvas.emit("pointerdown", { clientX: 100, clientY: 20 });
    app.canvas.emit("pointermove", { clientX: 110, clientY: 30 });
    app.clearBtn.emit("click");
    app.canvas.emit("pointermove", { clientX: 130, clientY: 50 });
    app.canvas.emit("pointerup", { clientX: 120, clientY: 40 });
    assert.equal(app.canvas.hasPointerCapture(1), false);
    assert.equal(app.undoBtn.disabled, false);
    assert.equal(app.redoBtn.disabled, true);
    app.tick();
    assert.equal(app.worker.requests.length, 0);
    app.undoBtn.emit("click");
    app.canvas.emit("pointercancel");
    app.canvas.emit("pointerup", { clientX: 150, clientY: 60 });
    app.tick();
    const restored = app.worker.requests[0].strokes;
    assert.deepEqual(restored.map(s => s.points[0].x), [10, 100]);
    assert.deepEqual(restored[1].points, [{ x: 100, y: 20 }, { x: 110, y: 30 }]);
});

test("redraw after undo, redo and resize preserves logical coordinates and dots", async () => {
    const app = await setup();
    app.stroke(10, true);
    app.stroke(50);
    app.canvas.calls.length = 0;
    app.undoBtn.emit("click");
    assert.deepEqual(app.canvas.calls.filter(c => c.name === "arc").map(c => c.args[0]), [10]);
    app.redoBtn.emit("click");
    app.canvas.rectangle.width = 450;
    app.canvas.rectangle.height = 200;
    app.canvas.calls.length = 0;
    app.resize();
    assert.equal(app.canvas.width, 900);
    assert.equal(app.canvas.height, 400);
    assert.deepEqual(app.canvas.calls.filter(c => c.name === "arc").map(c => c.args[0]), [10, 50]);
    assert.deepEqual(app.canvas.calls.find(c => c.name === "setTransform").args, [1, 0, 0, 1, 0, 0]);
});

test("model readiness recognizes restored history without changing cleared output", async () => {
    const app = await setup({ ready: false });
    app.stroke(10);
    app.undoBtn.emit("click");
    app.tick();
    app.message({ type: "ready" });
    assert.equal(app.answer.textContent, "");
    app.tick();
    assert.equal(app.worker.requests.length, 0);
    app.redoBtn.emit("click");
    app.tick();
    assert.equal(app.worker.requests[0].strokes.length, 1);
});

test("Clear is one action among strokes, with undo and redo in the correct order", async () => {
    const app = await setup();
    app.stroke(10);
    app.stroke(50, true);
    app.clearBtn.emit("click");
    assert.equal(app.undoBtn.disabled, false);
    app.undoBtn.emit("click");
    app.canvas.calls.length = 0;
    app.resize();
    assert.deepEqual(app.canvas.calls.filter(c => c.name === "arc").map(c => c.args[0]), [10, 50]);
    app.undoBtn.emit("click");
    app.redoBtn.emit("click");
    app.redoBtn.emit("click"); // Redo Clear.
    assert.equal(app.redoBtn.disabled, true);
    app.canvas.calls.length = 0;
    app.resize();
    assert.equal(app.canvas.calls.some(c => c.name === "arc"), false);
    app.undoBtn.emit("click");
    app.tick();
    assert.deepEqual(app.worker.requests[0].strokes.map(s => s.points[0].x), [10, 50]);
});

test("empty Clear leaves redo intact and never adds another Clear action", async () => {
    const app = await setup();
    app.clearBtn.emit("click");
    assert.equal(app.undoBtn.disabled, true);
    app.stroke(10);
    app.undoBtn.emit("click");
    app.clearBtn.emit("click");
    assert.equal(app.undoBtn.disabled, true);
    assert.equal(app.redoBtn.disabled, false);
    app.redoBtn.emit("click");
    app.clearBtn.emit("click");
    app.clearBtn.emit("click");
    app.undoBtn.emit("click");
    app.tick();
    assert.equal(app.worker.requests[0].strokes.length, 1);
});

test("new drawing or a nonempty Clear discards redo history", async () => {
    for (const edit of [app => app.stroke(100), app => app.clearBtn.emit("click")]) {
        const app = await setup();
        app.stroke(10);
        app.stroke(50);
        app.clearBtn.emit("click");
        app.undoBtn.emit("click");
        edit(app);
        assert.equal(app.redoBtn.disabled, true);
    }
});

test("Clear undo/redo during busy recognition rejects stale preview and results", async () => {
    const app = await setup();
    app.stroke(10);
    app.stroke(50);
    app.tick();
    const old = app.worker.requests[0];
    app.clearBtn.emit("click");
    app.undoBtn.emit("click");
    app.redoBtn.emit("click");
    app.undoBtn.emit("click");
    app.tick();
    app.preview.calls.length = 0;
    app.message({ type: "preview", version: old.version, width: 1, height: 1, pixels: new Uint8ClampedArray(4) });
    app.message({ type: "result", version: old.version, latex: "old" });
    assert.equal(app.answer.textContent, "");
    assert.equal(app.preview.calls.length, 0);
    app.tick();
    const latest = app.worker.requests.at(-1);
    assert.ok(latest.version > old.version);
    assert.equal(latest.strokes.length, 2);
    app.message({ type: "result", version: latest.version, latex: "2+3=" });
    assert.equal(app.answer.textContent, "answer:2+3=");
    app.redoBtn.emit("click");
    assert.equal(app.answer.textContent, "");
    assert.equal(app.preview.calls.at(-1).name, "clearRect");
});

test("keyboard shortcuts use action history and prevent native browser undo", async () => {
    for (const modifier of ["ctrlKey", "metaKey"]) {
        const app = await setup();
        app.stroke(10);
        app.clearBtn.emit("click");
        assert.equal(app.key("z", { [modifier]: true }).defaultPrevented, true);
        assert.equal(app.redoBtn.disabled, false);
        assert.equal(app.key("Z", { [modifier]: true, shiftKey: true }).defaultPrevented, true);
        assert.equal(app.redoBtn.disabled, true);
        app.key("z", { [modifier]: true });
        app.key("z", { [modifier]: true });
        assert.equal(app.undoBtn.disabled, true);
        assert.equal(app.key("z", { [modifier]: true }).defaultPrevented, true);
    }
    const app = await setup();
    app.stroke(10);
    app.key("z", { ctrlKey: true });
    assert.equal(app.key("y", { ctrlKey: true }).defaultPrevented, true);
    assert.equal(app.redoBtn.disabled, true);
    const mac = await setup({ platform: "MacIntel" });
    assert.equal(mac.key("y", { ctrlKey: true }).defaultPrevented, false);
});

test("editable targets, unrelated combinations and handled events keep their own shortcuts", async () => {
    const app = await setup();
    app.stroke(10);
    for (const target of [
        { isContentEditable: true },
        ...["INPUT", "TEXTAREA", "SELECT", "textbox"].map(tag => ({
            matches: selector => selector.includes(tag.toLowerCase())
        }))
    ]) {
        assert.equal(app.key("z", { ctrlKey: true, target }).defaultPrevented, false);
    }
    assert.equal(app.key("z", {
        ctrlKey: true, composedPath: () => [{}, { isContentEditable: true }]
    }).defaultPrevented, false);
    for (const fields of [{}, { ctrlKey: true, altKey: true }]) {
        assert.equal(app.key("z", fields).defaultPrevented, false);
    }
    assert.equal(app.key("x", { ctrlKey: true }).defaultPrevented, false);
    app.key("z", { ctrlKey: true, defaultPrevented: true });
    app.tick();
    assert.equal(app.worker.requests[0].strokes.length, 1);
});

test("shortcuts cannot change history during a stroke; capture loss finishes it once", async () => {
    const app = await setup();
    app.stroke(10);
    app.undoBtn.emit("click");
    app.canvas.emit("pointerdown", { clientX: 100, clientY: 20, pointerType: "touch" });
    assert.equal(app.key("z", { ctrlKey: true }).defaultPrevented, true);
    app.key("Z", { ctrlKey: true, shiftKey: true });
    assert.equal(app.undoBtn.disabled, true);
    assert.equal(app.redoBtn.disabled, true);
    app.canvas.releasePointerCapture(1);
    app.canvas.emit("pointerup", { clientX: 120, clientY: 30 });
    app.tick();
    assert.deepEqual(app.worker.requests[0].strokes.map(s => s.points[0].x), [100]);
    assert.equal(app.redoBtn.disabled, true);
    app.undoBtn.emit("click");
    assert.equal(app.undoBtn.disabled, true);
});

test("a delayed duplicate reply cannot release a newer busy request", async () => {
    const app = await setup();
    app.stroke(10);
    app.tick();
    const first = app.worker.requests[0];
    app.message({ type: "result", version: first.version, latex: "1=" });
    app.stroke(50);
    app.tick();
    const second = app.worker.requests[1];
    app.undoBtn.emit("click");
    app.preview.calls.length = 0;
    app.message({ type: "preview", version: first.version, width: 1, height: 1, pixels: new Uint8ClampedArray(4) });
    app.message({ type: "result", version: first.version, latex: "old duplicate" });
    app.message({ type: "unexpected", version: second.version });
    app.tick();
    assert.equal(app.worker.requests.length, 2); // Second request still owns the worker.
    assert.equal(app.answer.textContent, "");
    assert.equal(app.preview.calls.length, 0);
    app.message({ type: "result", version: second.version, latex: "outdated second" });
    app.tick();
    assert.equal(app.worker.requests.length, 3);
    const latest = app.worker.requests[2];
    assert.deepEqual(latest.strokes.map(s => s.points[0].x), [10]);
});

test("pointer cancellation commits the visible stroke once and drawing can continue", async () => {
    const app = await setup();
    app.canvas.emit("pointerdown", { clientX: 10, clientY: 20, pointerType: "touch" });
    app.canvas.emit("pointermove", { clientX: 30, clientY: 40 });
    app.canvas.emit("pointercancel", { clientX: 500, clientY: 500 });
    app.canvas.emit("lostpointercapture");
    app.canvas.emit("pointerup", { clientX: 600, clientY: 600 });
    assert.equal(app.canvas.hasPointerCapture(1), false);
    app.stroke(50, true);
    app.tick();
    const [cancelled, dot] = app.worker.requests[0].strokes;
    assert.deepEqual(cancelled.points, [{ x: 10, y: 20 }, { x: 30, y: 40 }]);
    assert.deepEqual(dot.points, [{ x: 50, y: 20 }]);
    app.undoBtn.emit("click");
    app.undoBtn.emit("click");
    assert.equal(app.undoBtn.disabled, true);
});

test("secondary pointers cannot alter or end the active primary stroke", async () => {
    const app = await setup();
    app.canvas.emit("pointerdown", { pointerId: 2, isPrimary: false, clientX: 500, clientY: 500 });
    assert.equal(app.canvas.hasPointerCapture(2), false);
    app.canvas.emit("pointerdown", { clientX: 10, clientY: 20 });
    app.canvas.emit("pointermove", { pointerId: 2, clientX: 500, clientY: 500 });
    app.canvas.emit("pointercancel", { pointerId: 2 });
    assert.equal(app.undoBtn.disabled, true);
    app.canvas.emit("pointerup", { clientX: 20, clientY: 30 });
    app.tick();
    assert.deepEqual(app.worker.requests[0].strokes[0].points, [{ x: 10, y: 20 }, { x: 20, y: 30 }]);
});

test("resizing while drawing preserves logical stroke data through Clear and restoration", async () => {
    const app = await setup();
    app.canvas.emit("pointerdown", { clientX: 100, clientY: 20 });
    app.canvas.rectangle = { left: 10, top: 10, width: 450, height: 200 };
    app.resize();
    app.canvas.emit("pointermove", { clientX: 110, clientY: 30 });
    app.clearBtn.emit("click");
    app.undoBtn.emit("click");
    app.canvas.rectangle = { left: 0, top: 0, width: 900, height: 400 };
    app.resize();
    app.tick();
    assert.deepEqual(app.worker.requests[0].strokes[0].points, [{ x: 100, y: 20 }, { x: 200, y: 40 }]);
    assert.equal(app.canvas.width, 1800);
    assert.equal(app.canvas.height, 800);
});

test("history waits for both model and calculator readiness in either startup order", async () => {
    for (const modelFirst of [true, false]) {
        let resolveEvaluator;
        const evaluatorPromise = new Promise(resolve => { resolveEvaluator = resolve; });
        const app = await setup({ ready: false, loadEvaluator: () => evaluatorPromise });
        app.stroke(10);
        app.stroke(50);
        app.clearBtn.emit("click");
        app.undoBtn.emit("click");
        if (modelFirst) app.message({ type: "ready" });
        else {
            resolveEvaluator({ calculate: value => `answer:${value}` });
            await app.settle();
        }
        app.tick();
        assert.equal(app.worker.requests.length, 0);
        if (modelFirst) {
            resolveEvaluator({ calculate: value => `answer:${value}` });
            await app.settle();
        } else app.message({ type: "ready" });
        assert.equal(app.answer.textContent, "");
        app.tick();
        assert.equal(app.worker.requests.length, 1);
        assert.deepEqual(app.worker.requests[0].strokes.map(s => s.points[0].x), [10, 50]);
    }
});

test("late calculator readiness cannot repopulate an emptied drawing", async () => {
    let resolveEvaluator;
    const app = await setup({ loadEvaluator: () => new Promise(resolve => { resolveEvaluator = resolve; }) });
    app.stroke(10);
    app.clearBtn.emit("click");
    resolveEvaluator({ calculate: value => `answer:${value}` });
    await app.settle();
    app.tick();
    assert.equal(app.answer.textContent, "");
    assert.equal(app.worker.requests.length, 0);
});

test("a current recognition error is shown and the next edit can be recognized", async () => {
    const app = await setup();
    app.stroke(10);
    app.tick();
    const first = app.worker.requests[0];
    app.message({ type: "preview", version: first.version, width: 1, height: 1, pixels: new Uint8ClampedArray(4) });
    assert.equal(app.preview.calls.at(-1).name, "putImageData");
    app.message({ type: "error", version: first.version, message: "test inference failure" });
    assert.equal(app.answer.textContent, "Recognition failed: test inference failure");
    app.stroke(50);
    assert.equal(app.answer.textContent, "");
    assert.equal(app.preview.calls.at(-1).name, "clearRect");
    app.tick();
    const second = app.worker.requests[1];
    app.message({ type: "result", version: second.version, latex: "2=" });
    assert.equal(app.answer.textContent, "answer:2=");
});

test("a fatal worker error rejects later messages but keeps drawing history usable", async () => {
    const app = await setup();
    app.stroke(10);
    app.tick();
    const first = app.worker.requests[0];
    app.worker.onerror({ message: "worker stopped" });
    app.message({ type: "result", version: first.version, latex: "late result" });
    assert.equal(app.answer.textContent, "Recognition worker failed: worker stopped");
    app.undoBtn.emit("click");
    app.redoBtn.emit("click");
    app.tick();
    assert.equal(app.worker.requests.length, 1);
    assert.equal(app.undoBtn.disabled, false);
});

test("startup failures report the failed component without sending recognition requests", async () => {
    const modelFailure = await setup({ ready: false });
    modelFailure.stroke(10);
    modelFailure.message({ type: "init-error", message: "model unavailable" });
    modelFailure.tick();
    assert.equal(modelFailure.answer.textContent, "Model failed to load: model unavailable");
    assert.equal(modelFailure.worker.requests.length, 0);
    const calculatorFailure = await setup({ loadEvaluator: async () => { throw new Error("WASM unavailable"); } });
    await calculatorFailure.settle();
    assert.equal(calculatorFailure.answer.textContent, "Calculator failed to load: WASM unavailable");
    calculatorFailure.stroke(10);
    calculatorFailure.tick();
    assert.equal(calculatorFailure.worker.requests.length, 0);
});

test("restored drawings use the real LaTeX formatter and bundled WASM calculator", async () => {
    const binary = await readFile(new URL("../backend/evaluate.wasm", import.meta.url));
    const wasmModule = new WebAssembly.Module(binary);
    const calculator = await createEvaluator({
        instantiateWasm(imports, receiveInstance) {
            const instance = new WebAssembly.Instance(wasmModule, imports);
            receiveInstance(instance);
            return instance.exports;
        }
    });
    const app = await setup({ loadEvaluator: async () => calculator, format: formatLatex });
    app.stroke(10);
    app.stroke(50);
    app.tick();
    const original = app.worker.requests[0];
    app.message({ type: "result", version: original.version, latex: "2 \\times 3 =" });
    assert.equal(app.answer.textContent, "6");
    assert.deepEqual(historyRows(app), [["2*3 = ", "6"]]);
    app.clearBtn.emit("click");
    app.undoBtn.emit("click");
    app.tick();
    const restored = app.worker.requests[1];
    assert.deepEqual(restored.strokes, original.strokes);
    app.message({ type: "result", version: restored.version, latex: "2 \\times 3 =" });
    assert.equal(app.answer.textContent, "6");
    app.undoBtn.emit("click");
    app.redoBtn.emit("click");
    app.tick();
    const redone = app.worker.requests[2];
    assert.deepEqual(redone.strokes, original.strokes);
    app.message({ type: "result", version: redone.version, latex: "\\frac{12}{4}=" });
    assert.equal(app.answer.textContent, "3");
    assert.deepEqual(historyRows(app), [["(12)/(4) = ", "3"], ["2*3 = ", "6"], ["2*3 = ", "6"]]);
    app.stroke(100);
    app.tick();
    app.message({ type: "result", version: app.worker.requests[3].version, latex: "2+3" });
    assert.equal(app.answer.textContent, ""); // An incomplete expression is not calculated.
    app.stroke(150);
    app.tick();
    app.message({ type: "result", version: app.worker.requests[4].version, latex: "x=" });
    assert.match(app.answer.textContent, /Unsupported symbol/);
    app.undoBtn.emit("click");
    app.tick();
    app.message({ type: "result", version: app.worker.requests[5].version, latex: "1/0=" });
    assert.equal(app.answer.textContent, "Undefined");
});

function recognizedDrawing(app) {
    app.tick();
    const request = app.worker.requests.at(-1);
    assert.ok(request, "drawing should reach recognition");
    app.message({ type: "result", version: request.version, latex: "1=" });
    return request.strokes;
}

function erase(app, x, y = 20, endX = x, mode = "stroke") {
    app.eraserMode.value = mode;
    app.eraserMode.emit("change");
    app.canvas.emit("pointerdown", { clientX: x, clientY: y });
    app.canvas.emit("pointermove", { clientX: endX, clientY: y });
    app.canvas.emit("pointerup", { clientX: endX, clientY: y });
}

test("pencil widths, tool settings and cursor selection survive undo/redo", async () => {
    const app = await setup();
    assert.equal(app.pencilBtn.getAttribute("aria-pressed"), "true");
    app.sizeSlider.value = "8";
    app.sizeSlider.emit("input");
    app.stroke(10, true);
    app.sizeSlider.value = "18";
    app.sizeSlider.emit("input");
    app.stroke(50);
    const original = recognizedDrawing(app);
    assert.deepEqual(original.map(s => s.lineWidth), [8, 18]);
    app.eraserBtn.emit("click");
    app.sizeSlider.value = "60";
    app.sizeSlider.emit("input");
    app.pencilBtn.emit("click");
    assert.equal(app.sizeSlider.value, "18");
    app.undoBtn.emit("click");
    assert.equal(recognizedDrawing(app)[0].lineWidth, 8);
    app.redoBtn.emit("click");
    assert.deepEqual(recognizedDrawing(app), original);
    app.eraserBtn.emit("click");
    assert.equal(app.sizeSlider.value, "60");
    assert.equal(app.sizeSlider.getAttribute("aria-label"), "Eraser size");
    assert.equal(app.eraserBtn.classList.contains("active"), true);
    assert.match(app.canvas.style.cursor, /data:image\/svg\+xml/);
});

test("a whole stroke-eraser sweep is one action even when it removes several strokes", async () => {
    const app = await setup();
    app.stroke(10);
    app.stroke(50, true);
    app.stroke(100);
    const original = recognizedDrawing(app);
    erase(app, 10, 20, 100);
    app.canvas.calls.length = 0;
    app.resize();
    assert.equal(app.canvas.calls.some(c => c.name === "arc"), false);
    assert.equal(app.undoBtn.disabled, false);
    app.undoBtn.emit("click");
    assert.deepEqual(recognizedDrawing(app), original);
    app.undoBtn.emit("click");
    assert.deepEqual(recognizedDrawing(app), original.slice(0, 2));
    app.redoBtn.emit("click");
    app.redoBtn.emit("click");
    app.canvas.calls.length = 0;
    app.resize();
    assert.equal(app.canvas.calls.some(c => c.name === "arc"), false);
    assert.equal(app.redoBtn.disabled, true);
});

test("pixel eraser undo restores the exact original; redo restores separated fragments", async () => {
    const app = await setup();
    app.sizeSlider.value = "10";
    app.sizeSlider.emit("input");
    app.canvas.emit("pointerdown", { clientX: 10, clientY: 100 });
    app.canvas.emit("pointerup", { clientX: 310, clientY: 100 });
    const original = recognizedDrawing(app);
    erase(app, 160, 100, 160, "pixel");
    const fragments = recognizedDrawing(app);
    assert.equal(fragments.length, 2);
    assert.ok(fragments[0].points.at(-1).x < 160);
    assert.ok(fragments[1].points[0].x > 160);
    assert.ok(fragments.every(s => s.lineWidth === 10));
    app.undoBtn.emit("click");
    assert.deepEqual(recognizedDrawing(app), original);
    app.redoBtn.emit("click");
    app.canvas.rectangle.width = 450;
    app.canvas.rectangle.height = 200;
    app.resize();
    assert.deepEqual(recognizedDrawing(app), fragments);
    assert.equal(app.eraserMode.value, "pixel");
    assert.equal(app.eraserBtn.getAttribute("aria-pressed"), "true");
});

test("tool changes and erasing empty space preserve redo for both eraser modes", async () => {
    for (const mode of ["stroke", "pixel"]) {
        const app = await setup();
        app.stroke(10);
        app.stroke(50);
        app.undoBtn.emit("click");
        erase(app, 850, 300, 880, mode);
        assert.equal(app.redoBtn.disabled, false);
        app.redoBtn.emit("click");
        assert.deepEqual(recognizedDrawing(app).map(s => s.points[0].x), [10, 50]);
        app.undoBtn.emit("click");
        app.undoBtn.emit("click");
        assert.equal(app.undoBtn.disabled, true); // No empty eraser action was added.
    }
});

test("a real eraser edit after undo discards redo history", async () => {
    for (const mode of ["stroke", "pixel"]) {
        const app = await setup();
        app.stroke(10);
        app.stroke(50);
        app.undoBtn.emit("click");
        erase(app, 10, 20, 10, mode);
        assert.equal(app.redoBtn.disabled, true);
        app.undoBtn.emit("click");
        assert.deepEqual(recognizedDrawing(app).map(s => s.points[0].x), [10]);
    }
});

test("Clear during an eraser drag records the visible edit and ignores later pointer events", async () => {
    const app = await setup();
    app.stroke(10);
    app.stroke(50);
    const original = recognizedDrawing(app);
    app.eraserBtn.emit("click");
    app.canvas.emit("pointerdown", { clientX: 10, clientY: 20 });
    assert.equal(app.undoBtn.disabled, true);
    app.undoBtn.emit("click");
    app.clearBtn.emit("click");
    assert.equal(app.canvas.hasPointerCapture(1), false);
    app.canvas.emit("pointermove", { clientX: 50, clientY: 20 });
    app.canvas.emit("pointerup", { clientX: 50, clientY: 20 });
    app.undoBtn.emit("click"); // Undo Clear, leaving only the second stroke.
    assert.deepEqual(recognizedDrawing(app), original.slice(1));
    app.undoBtn.emit("click"); // Undo the complete eraser gesture.
    assert.deepEqual(recognizedDrawing(app), original);
    app.redoBtn.emit("click");
    app.redoBtn.emit("click");
    assert.equal(app.redoBtn.disabled, true);
});

test("eraser cancellation commits once; tool and size changes are blocked until it ends", async () => {
    const app = await setup();
    app.stroke(10);
    app.stroke(50);
    const original = recognizedDrawing(app);
    app.eraserBtn.emit("click");
    app.canvas.emit("pointerdown", { clientX: 10, clientY: 20 });
    app.pencilBtn.emit("click");
    app.eraserMode.value = "pixel";
    app.eraserMode.emit("change");
    app.sizeSlider.value = "80";
    app.sizeSlider.emit("input");
    assert.equal(app.eraserBtn.getAttribute("aria-pressed"), "true");
    assert.equal(app.eraserMode.value, "stroke");
    assert.equal(app.sizeSlider.value, "24");
    app.key("z", { ctrlKey: true });
    app.canvas.emit("pointercancel");
    app.canvas.emit("lostpointercapture");
    app.canvas.emit("pointerup", { clientX: 50, clientY: 20 });
    assert.deepEqual(recognizedDrawing(app), original.slice(1));
    app.undoBtn.emit("click");
    assert.deepEqual(recognizedDrawing(app), original);
    app.pencilBtn.emit("click");
    assert.equal(app.pencilBtn.getAttribute("aria-pressed"), "true");
});

test("eraser edits and their history never accept outdated recognition results", async () => {
    const app = await setup();
    app.stroke(10);
    app.stroke(50);
    app.tick();
    const old = app.worker.requests[0];
    erase(app, 10);
    app.undoBtn.emit("click");
    app.redoBtn.emit("click");
    app.tick();
    assert.equal(app.worker.requests.length, 1);
    app.message({ type: "result", version: old.version, latex: "outdated" });
    assert.equal(app.answer.textContent, "");
    app.tick();
    const latest = app.worker.requests[1];
    assert.deepEqual(latest.strokes.map(s => s.points[0].x), [50]);
    app.message({ type: "result", version: latest.version, latex: "1=" });
    assert.equal(app.answer.textContent, "answer:1=");
});
