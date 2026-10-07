import createEvaluator from "./evaluate.js";
import { formatLatex } from "./formatter.js";

const canvas = document.getElementById("canvas");
const context = canvas.getContext("2d");
const display = document.getElementById("answer");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const strokes = [];
const undoActions = [];
const redoActions = [];
const calculationHistory = [];
const calculationHistoryLimit = 10;
const logicalWidth = 900;
const logicalHeight = 400;

let currentStroke = null;
let activeTool = "pencil";
let erasingPointer = null;
let lastEraserPoint = null;
let eraserBefore = null;
let eraserChanged = false;

let eraserMode = "stroke";

const eraserModeSelect = document.getElementById("eraserMode");

eraserModeSelect.addEventListener("change", function () {
    if (currentStroke || erasingPointer !== null) {
        eraserModeSelect.value = eraserMode;
        return;
    }

    eraserMode = eraserModeSelect.value;
    selectTool("eraser");
});

let pencilWidth = 5;
let eraserRadius = 12;

const sizeSlider = document.getElementById("sizeSlider");
const sizeValue = document.getElementById("sizeValue");

function syncSizeControl() {
    const pencil = activeTool === "pencil";

    sizeSlider.min = pencil ? "1" : "8";
    sizeSlider.max = pencil ? "20" : "80";
    sizeSlider.value = String(
        pencil ? pencilWidth : eraserRadius * 2
    );

    sizeSlider.setAttribute(
        "aria-label",
        pencil ? "Pencil thickness" : "Eraser size"
    );

    sizeValue.textContent = sizeSlider.value;
}

function updateCursor() {
    let svg;
    let hotspotX;
    let hotspotY;

    if (activeTool === "pencil") {
        svg = `
          <svg xmlns="http://www.w3.org/2000/svg"
               width="32" height="32" viewBox="0 0 32 32">
            <path
              d="M4 26 L7 17 L22 2 Q24 0 26 2
                 L29 5 Q31 7 29 9 L14 24 Z"
              fill="#b5a1ff" stroke="#15121c"
              stroke-width="2"/>
            <path d="M7 17 L14 24 L4 26 Z"
              fill="#fff4d6" stroke="#15121c"
              stroke-width="1.5"/>
            <path d="M4 26 L9 25 L5 21 Z"
              fill="#15121c"/>
            <path d="M19 5 L26 12"
              stroke="#ffffff" stroke-width="2"/>
          </svg>`;

        hotspotX = 4;
        hotspotY = 26;
    } else {
        const scale =
            canvas.getBoundingClientRect().width / logicalWidth;

        const radius = Math.max(2, eraserRadius * scale);
        const side = Math.ceil(radius * 2 + 8);
        const center = Math.floor(side / 2);

        svg = `
          <svg xmlns="http://www.w3.org/2000/svg"
               width="${side}" height="${side}">
            <circle cx="${center}" cy="${center}" r="${radius}"
              fill="#b5a1ff" fill-opacity="0.12"
              stroke="#111018" stroke-width="4"/>
            <circle cx="${center}" cy="${center}" r="${radius}"
              fill="none" stroke="#e6dcff" stroke-width="2"/>
          </svg>`;

        hotspotX = center;
        hotspotY = center;
    }

    canvas.style.cursor =
        `url("data:image/svg+xml,${encodeURIComponent(svg)}") ` +
        `${hotspotX} ${hotspotY}, default`;
}

sizeSlider.addEventListener("input", function () {
    if (currentStroke || erasingPointer !== null) {
        syncSizeControl();
        return;
    }

    const size = Number(sizeSlider.value);

    if (activeTool === "pencil") {
        pencilWidth = size;
    } else {
        eraserRadius = size / 2;
    }

    sizeValue.textContent = String(size);
    updateCursor();
});
const pencilBtn = document.getElementById("pencilBtn");
const eraserBtn = document.getElementById("eraserBtn");

function selectTool(tool) {
    if (currentStroke || erasingPointer !== null) return;

    activeTool = tool;

    for (const [button, name] of [
        [pencilBtn, "pencil"],
        [eraserBtn, "eraser"]
    ]) {
        const selected = tool === name;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-pressed", String(selected));
    }

    syncSizeControl();
    updateCursor();
}

pencilBtn.addEventListener("click", () => selectTool("pencil"));
eraserBtn.addEventListener("click", () => selectTool("eraser"));
selectTool("pencil");

let drawingVersion = 0;
let recognitionTimer;
let recognitionBusy = false;
let recognitionVersion = null;
let recognitionPending = false;
let modelReady = false;
let evaluator;

// Recognition and preprocessing run outside the drawing thread.
const worker = new Worker(
    new URL("./recognition.worker.js", import.meta.url),
    { type: "module" }
);

createEvaluator().then(function (module) {
    evaluator = module;

    if (modelReady) {
        if (drawingVersion === 0) display.textContent = "Handwriting model ready";
        scheduleRecognition();
    }
}).catch(function (error) {
    display.textContent = "Calculator failed to load: " + error.message;
});

function showAnswer(latex) {
    console.log("Model output:", latex);

    try {
        const expression = formatLatex(latex);
        console.log("Formatted:", expression);

        if (expression === null) {
            display.textContent = "";
            return;
        }

        const answer = String(evaluator.calculate(expression));
        display.textContent = answer;
        if (answer !== "Waiting" && !answer.startsWith("Error:")) {
            calculationHistory.push({ equation: expression, answer });
            if (calculationHistory.length > calculationHistoryLimit) {
                calculationHistory.shift();
            }
            renderCalculationHistory();
        }
    } catch (error) {
        display.textContent =
            "Recognized: " + latex + " — " + error.message;
    }
}

function renderCalculationHistory() {
    const rows = calculationHistory.slice().reverse().map(({ equation, answer }) => {
        const row = document.createElement("li");
        const equationText = document.createElement("span");
        const answerText = document.createElement("strong");
        equationText.textContent = equation.replace(/=$/, "") + " = ";
        answerText.textContent = answer;
        row.append(equationText, answerText);
        return row;
    });
    document.getElementById("calculationHistory").replaceChildren(...rows);
    document.getElementById("historyEmpty").hidden = rows.length > 0;
    document.getElementById("historyCount").textContent =
        `${rows.length} / ${calculationHistoryLimit}`;
}

function drawDot(point, width) {
    context.beginPath();
    context.arc(point.x, point.y, width / 2, 0, Math.PI * 2);
    context.fill();
}

function drawStroke(stroke) {
    const points = stroke.points;
    if (!points.length) return;

    context.lineWidth = stroke.lineWidth;
    drawDot(points[0], stroke.lineWidth);

    context.beginPath();
    context.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i++) {
        const previous = points[i - 1];
        const point = points[i];

        context.quadraticCurveTo(
            previous.x,
            previous.y,
            (previous.x + point.x) / 2,
            (previous.y + point.y) / 2
        );
    }

    const last = points[points.length - 1];
    context.lineTo(last.x, last.y);
    context.stroke();
}

function resizeCanvas() {
    const rectangle = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;

    canvas.width = Math.round(rectangle.width * ratio);
    canvas.height = Math.round(rectangle.height * ratio);

    context.setTransform(
        canvas.width / logicalWidth,
        0,
        0,
        canvas.height / logicalHeight,
        0,
        0
    );

    context.strokeStyle = "#ffffff";
    context.fillStyle = "#ffffff";
    context.lineWidth = pencilWidth;
    context.lineCap = "round";
    context.lineJoin = "round";

    for (const stroke of strokes) drawStroke(stroke);
    if (currentStroke) drawStroke(currentStroke);

    updateCursor();
}

resizeCanvas();
updateHistoryButtons();
new ResizeObserver(resizeCanvas).observe(canvas);

function getPoint(event) {
    const rectangle = canvas.getBoundingClientRect();

    return {
        x: (event.clientX - rectangle.left)
            * logicalWidth / rectangle.width,
        y: (event.clientY - rectangle.top)
            * logicalHeight / rectangle.height
    };
}

function clearPreview() {
    const preview = document.getElementById("preview");

    preview.getContext("2d").clearRect(
        0, 0, preview.width, preview.height
    );
}

function updateHistoryButtons() {
    const editing = currentStroke !== null || erasingPointer !== null;
    undoBtn.disabled = editing || undoActions.length === 0;
    redoBtn.disabled = editing || redoActions.length === 0;
}

function invalidateDrawing() {
    clearTimeout(recognitionTimer);
    recognitionPending = false;
    drawingVersion += 1;
    display.textContent = "";
    clearPreview();
}

function historyChanged() {
    invalidateDrawing();
    redrawInk();
    updateHistoryButtons();
    scheduleRecognition();
}

function restoreStrokes(saved) {
    strokes.length = 0;
    for (const stroke of saved) strokes.push(stroke);
}

function redrawInk() {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.restore();

    for (const stroke of strokes) drawStroke(stroke);
}

function pointSegmentDistance(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;

    const t = lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1,
            ((point.x - a.x) * dx + (point.y - a.y) * dy)
            / lengthSquared
        ));

    return Math.hypot(
        point.x - a.x - t * dx,
        point.y - a.y - t * dy
    );
}

// Test against the same quadratic curves used to draw the stroke.
function strokeTouchesPoint(stroke, point) {
    const points = stroke.points;
    if (!points.length) return false;

    const radius = eraserRadius + stroke.lineWidth / 2;
    let start = points[0];

    if (Math.hypot(
        point.x - start.x,
        point.y - start.y
    ) <= radius) {
        return true;
    }

    for (let i = 1; i < points.length; i++) {
        const control = points[i - 1];

        const end = {
            x: (control.x + points[i].x) / 2,
            y: (control.y + points[i].y) / 2
        };

        const steps = Math.max(4, Math.ceil((
            Math.hypot(
                control.x - start.x,
                control.y - start.y
            ) +
            Math.hypot(
                end.x - control.x,
                end.y - control.y
            )
        ) / 4));

        let previous = start;

        for (let j = 1; j <= steps; j++) {
            const t = j / steps;
            const u = 1 - t;

            const sample = {
                x: u * u * start.x
                    + 2 * u * t * control.x
                    + t * t * end.x,
                y: u * u * start.y
                    + 2 * u * t * control.y
                    + t * t * end.y
            };

            if (pointSegmentDistance(
                point, previous, sample
            ) <= radius) {
                return true;
            }

            previous = sample;
        }

        start = end;
    }

    return pointSegmentDistance(
        point, start, points[points.length - 1]
    ) <= radius;
}

// Convert the displayed curve into closely spaced points.
function flattenStroke(stroke) {
    const points = stroke.points;

    if (points.length < 2) return points.slice();

    const result = [points[0]];
    let start = points[0];

    for (let i = 1; i < points.length; i++) {
        const control = points[i - 1];

        const end = {
            x: (control.x + points[i].x) / 2,
            y: (control.y + points[i].y) / 2
        };

        const length =
            Math.hypot(control.x - start.x, control.y - start.y) +
            Math.hypot(end.x - control.x, end.y - control.y);

        const steps = Math.max(1, Math.ceil(length / 2));

        for (let j = 1; j <= steps; j++) {
            const t = j / steps;
            const u = 1 - t;

            result.push({
                x: u * u * start.x +
                    2 * u * t * control.x +
                    t * t * end.x,

                y: u * u * start.y +
                    2 * u * t * control.y +
                    t * t * end.y
            });
        }

        start = end;
    }

    const last = points[points.length - 1];

    const steps = Math.max(1, Math.ceil(
        Math.hypot(last.x - start.x, last.y - start.y) / 2
    ));

    for (let j = 1; j <= steps; j++) {
        result.push({
            x: start.x + (last.x - start.x) * j / steps,
            y: start.y + (last.y - start.y) * j / steps
        });
    }

    return result;
}

// Keep separate fragments so erased gaps are not reconnected.
function pixelEraseStroke(stroke, center) {
    const points = flattenStroke(stroke);
    const radius = eraserRadius + stroke.lineWidth / 2;

    const fragments = [];
    let remaining = [];

    function saveFragment() {
        if (remaining.length) {
            fragments.push({
                points: remaining,
                lineWidth: stroke.lineWidth
            });

            remaining = [];
        }
    }

    for (const point of points) {
        const distance = Math.hypot(
            point.x - center.x,
            point.y - center.y
        );

        if (distance <= radius) {
            saveFragment();
        } else {
            remaining.push(point);
        }
    }

    saveFragment();
    return fragments;
}

function eraseTo(point) {
    const from = lastEraserPoint || point;

    const steps = Math.max(1, Math.ceil(
        Math.hypot(point.x - from.x, point.y - from.y) / 4
    ));

    let changed = false;

    // Sweep between events so fast drags do not skip strokes.
    for (let step = 0; step <= steps; step++) {
        const t = step / steps;

        const sample = {
            x: from.x + (point.x - from.x) * t,
            y: from.y + (point.y - from.y) * t
        };

        for (let i = strokes.length - 1; i >= 0; i--) {
            if (strokeTouchesPoint(strokes[i], sample)) {
                if (eraserMode === "pixel") {
                    const fragments = pixelEraseStroke(strokes[i], sample);
                    strokes.splice(i, 1, ...fragments);
                } else {
                    strokes.splice(i, 1);
                }

                changed = true;
            }
        }
    }

    lastEraserPoint = point;

    if (changed) {
        eraserChanged = true;
        invalidateDrawing();
        redrawInk();
    }
}

canvas.addEventListener("pointerdown", function (event) {
    if (
        currentStroke !== null ||
        erasingPointer !== null ||
        event.button !== 0 ||
        event.isPrimary === false
    ) {
        return;
    }

    event.preventDefault();
    invalidateDrawing();

    canvas.setPointerCapture(event.pointerId);

    const point = getPoint(event);

    if (activeTool === "eraser") {
        erasingPointer = event.pointerId;
        lastEraserPoint = null;
        // Erasing replaces stroke records rather than mutating them. Preserve
        // both arrays so a whole drag (including pixel fragments) is one action.
        eraserBefore = strokes.slice();
        eraserChanged = false;
        updateHistoryButtons();
        eraseTo(point);
        return;
    }

    currentStroke = {
        pointerId: event.pointerId,
        points: [point],
        lineWidth: pencilWidth,
        drawX: point.x,
        drawY: point.y
    };
    updateHistoryButtons();

    context.lineWidth = pencilWidth;
    drawDot(point, pencilWidth);
});

function addPoint(event) {
    const point = getPoint(event);
    const previous =
        currentStroke.points[currentStroke.points.length - 1];

    if (point.x === previous.x && point.y === previous.y) return;

    const midX = (previous.x + point.x) / 2;
    const midY = (previous.y + point.y) / 2;

    context.lineWidth = currentStroke.lineWidth;
    context.beginPath();
    context.moveTo(currentStroke.drawX, currentStroke.drawY);
    context.quadraticCurveTo(
        previous.x, previous.y, midX, midY
    );
    context.stroke();

    currentStroke.points.push(point);
    currentStroke.drawX = midX;
    currentStroke.drawY = midY;
}

canvas.addEventListener("pointermove", function (event) {
    if (erasingPointer === event.pointerId) {
        event.preventDefault();

        const samples = event.getCoalescedEvents
            ? event.getCoalescedEvents()
            : [];

        for (const sample of samples) eraseTo(getPoint(sample));
        eraseTo(getPoint(event));
        return;
    }

    if (!currentStroke ||
        currentStroke.pointerId !== event.pointerId) {
        return;
    }

    const samples = event.getCoalescedEvents
        ? event.getCoalescedEvents()
        : [];

    for (const sample of samples) addPoint(sample);
    addPoint(event);
});

function finishStroke(event) {
    if (erasingPointer === event.pointerId) {
        if (event.type === "pointerup") eraseTo(getPoint(event));

        if (eraserChanged) {
            undoActions.push({ type: "erase", before: eraserBefore, after: strokes.slice() });
            redoActions.length = 0;
        }
        erasingPointer = null;
        lastEraserPoint = null;
        eraserBefore = null;
        eraserChanged = false;
        updateHistoryButtons();

        if (canvas.hasPointerCapture(event.pointerId)) {
            canvas.releasePointerCapture(event.pointerId);
        }

        scheduleRecognition();
        return;
    }

    if (!currentStroke ||
        currentStroke.pointerId !== event.pointerId) {
        return;
    }

    if (event.type === "pointerup") addPoint(event);

    const last =
        currentStroke.points[currentStroke.points.length - 1];

    context.beginPath();
    context.moveTo(currentStroke.drawX, currentStroke.drawY);
    context.lineTo(last.x, last.y);
    context.stroke();

    const stroke = {
        points: currentStroke.points,
        lineWidth: currentStroke.lineWidth
    };
    strokes.push(stroke);
    undoActions.push({ type: "stroke", stroke });
    redoActions.length = 0;

    currentStroke = null;
    invalidateDrawing();
    updateHistoryButtons();

    if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
    }

    scheduleRecognition();
}

canvas.addEventListener("pointerup", finishStroke);
canvas.addEventListener("pointercancel", finishStroke);
canvas.addEventListener("lostpointercapture", finishStroke);

function scheduleRecognition() {
    clearTimeout(recognitionTimer);
    recognitionPending = strokes.length > 0;
    if (!recognitionPending) return;

    recognitionTimer = setTimeout(function () {
        if (!recognitionPending ||
            !modelReady ||
            !evaluator ||
            recognitionBusy ||
            !strokes.length) {
            return;
        }

        if (currentStroke || erasingPointer !== null) return;

        recognitionPending = false;
        recognitionBusy = true;
        recognitionVersion = drawingVersion;
        worker.postMessage({ strokes, version: drawingVersion });
    }, 600);
}

worker.onmessage = function (event) {
    const message = event.data;

    if (message.type === "ready") {
        modelReady = true;

        if (evaluator) {
            if (drawingVersion === 0) display.textContent = "Handwriting model ready";
            scheduleRecognition();
        }

        return;
    }

    if (message.type === "init-error") {
        display.textContent =
            "Model failed to load: " + message.message;
        return;
    }

    // Delayed replies cannot update the preview or unlock a newer request.
    if (message.version !== recognitionVersion) return;
    const isCurrent =
        message.version === drawingVersion &&
        !currentStroke &&
        erasingPointer === null &&
        strokes.length > 0;

    if (message.type === "preview") {
        if (isCurrent) {
            const preview = document.getElementById("preview");

            preview.width = message.width;
            preview.height = message.height;

            preview.getContext("2d").putImageData(
                new ImageData(
                    message.pixels, message.width, message.height
                ),
                0, 0
            );
        }

        return;
    }

    if (message.type !== "result" && message.type !== "error") return;
    recognitionBusy = false;
    recognitionVersion = null;

    if (isCurrent) {
        if (message.type === "result") {
            showAnswer(message.latex);
        } else {
            display.textContent =
                "Recognition failed: " + message.message;
        }
    } else if (recognitionPending) {
        scheduleRecognition();
    }
};

worker.onerror = function (event) {
    modelReady = false;
    recognitionBusy = false;
    recognitionVersion = null;
    recognitionPending = false;

    display.textContent =
        "Recognition worker failed: " + event.message;
};

function undo() {
    if (currentStroke || erasingPointer !== null || !undoActions.length) return;
    const action = undoActions.pop();
    if (action.type === "clear") restoreStrokes(action.strokes);
    else if (action.type === "erase") restoreStrokes(action.before);
    else strokes.pop();
    redoActions.push(action);
    historyChanged();
}

function redo() {
    if (currentStroke || erasingPointer !== null || !redoActions.length) return;
    const action = redoActions.pop();
    if (action.type === "clear") strokes.length = 0;
    else if (action.type === "erase") restoreStrokes(action.after);
    else strokes.push(action.stroke);
    undoActions.push(action);
    historyChanged();
}

undoBtn.addEventListener("click", undo);
redoBtn.addEventListener("click", redo);

const isWindows = /^Win/i.test(navigator.userAgentData?.platform || navigator.platform);
document.addEventListener("keydown", function (event) {
    if (event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey)) return;
    const path = event.composedPath ? event.composedPath() : [event.target];
    if (path.some(element => element.isContentEditable ||
        element.matches?.("input, textarea, select, [role='textbox']"))) return;

    const key = event.key.toLowerCase();
    const undoShortcut = key === "z" && !event.shiftKey;
    const redoShortcut = (key === "z" && event.shiftKey) ||
        (isWindows && event.ctrlKey && !event.metaKey && !event.shiftKey && key === "y");
    if (!undoShortcut && !redoShortcut) return;

    event.preventDefault();
    if (undoShortcut) undo();
    else redo();
});

document.getElementById("clearBtn").addEventListener("click", function () {
    const pointerId = currentStroke?.pointerId ?? erasingPointer;
    if (pointerId !== null) {
        // Finish the visible pencil/eraser edit before recording Clear. Pointer
        // state is reset before capture is released, so later events are inert.
        finishStroke({ type: "clear", pointerId });
    }
    if (!strokes.length) return;
    undoActions.push({ type: "clear", strokes: strokes.slice() });
    strokes.length = 0;
    redoActions.length = 0;
    historyChanged();
});
