import createEvaluator from "./evaluate.js";
import { formatLatex } from "./formatter.js";

const canvas = document.getElementById("canvas");
const context = canvas.getContext("2d");
const display = document.getElementById("answer");
const strokes = [];
const logicalWidth = 900;
const logicalHeight = 400;
let currentStroke = null;
let drawingVersion = 0;
let recognitionTimer;
let recognitionBusy = false;
let modelReady = false;
let evaluator;

// Heavy recognition and preprocessing run outside this drawing thread.
const worker = new Worker(new URL("./recognition.worker.js", import.meta.url), {
    type: "module"
});

createEvaluator().then(function (module) {
    evaluator = module;
    if (modelReady) {
        display.textContent = "Handwriting model ready";
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
        display.textContent = expression === null ? "" : evaluator.calculate(expression);
    } catch (error) {
        display.textContent = "Recognized: " + latex + " — " + error.message;
    }
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
        context.quadraticCurveTo(previous.x, previous.y,
            (previous.x + point.x) / 2, (previous.y + point.y) / 2);
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
    context.setTransform(canvas.width / logicalWidth, 0, 0,
        canvas.height / logicalHeight, 0, 0);
    context.lineWidth = 5;
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const stroke of strokes) drawStroke(stroke);
    if (currentStroke) drawStroke(currentStroke);
}

resizeCanvas();
new ResizeObserver(resizeCanvas).observe(canvas);

function getPoint(event) {
    const rectangle = canvas.getBoundingClientRect();
    return {
        x: (event.clientX - rectangle.left) * logicalWidth / rectangle.width,
        y: (event.clientY - rectangle.top) * logicalHeight / rectangle.height
    };
}

canvas.addEventListener("pointerdown", function (event) {
    if (currentStroke !== null || event.button !== 0) return;
    clearTimeout(recognitionTimer);
    drawingVersion += 1;
    display.textContent = "";
    canvas.setPointerCapture(event.pointerId);
    const point = getPoint(event);
    currentStroke = {
        pointerId: event.pointerId, points: [point], lineWidth: 5,
        drawX: point.x, drawY: point.y
    };
    drawDot(point, 5);
});

function addPoint(event) {
    const point = getPoint(event);
    const previous = currentStroke.points[currentStroke.points.length - 1];
    if (point.x === previous.x && point.y === previous.y) return;
    const midX = (previous.x + point.x) / 2;
    const midY = (previous.y + point.y) / 2;
    context.lineWidth = currentStroke.lineWidth;
    context.beginPath();
    context.moveTo(currentStroke.drawX, currentStroke.drawY);
    context.quadraticCurveTo(previous.x, previous.y, midX, midY);
    context.stroke();
    currentStroke.points.push(point);
    currentStroke.drawX = midX;
    currentStroke.drawY = midY;
}

canvas.addEventListener("pointermove", function (event) {
    if (!currentStroke || currentStroke.pointerId !== event.pointerId) return;
    const samples = event.getCoalescedEvents ? event.getCoalescedEvents() : [];
    for (const sample of samples) addPoint(sample);
    addPoint(event);
});

function finishStroke(event) {
    if (!currentStroke || currentStroke.pointerId !== event.pointerId) return;
    if (event.type === "pointerup") addPoint(event);
    const last = currentStroke.points[currentStroke.points.length - 1];
    context.beginPath();
    context.moveTo(currentStroke.drawX, currentStroke.drawY);
    context.lineTo(last.x, last.y);
    context.stroke();
    strokes.push({ points: currentStroke.points, lineWidth: currentStroke.lineWidth });
    currentStroke = null;
    drawingVersion += 1;
    if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
    }
    scheduleRecognition();
}

canvas.addEventListener("pointerup", finishStroke);
canvas.addEventListener("pointercancel", finishStroke);

function scheduleRecognition() {
    clearTimeout(recognitionTimer);
    recognitionTimer = setTimeout(function () {
        if (!modelReady || !evaluator || recognitionBusy || !strokes.length) return;
        if (currentStroke) return;
        recognitionBusy = true;
        worker.postMessage({ strokes, version: drawingVersion });
    }, 600);
}

worker.onmessage = function (event) {
    const message = event.data;
    if (message.type === "ready") {
        modelReady = true;
        if (evaluator) {
            display.textContent = "Handwriting model ready";
            scheduleRecognition();
        }
        return;
    }
    if (message.type === "init-error") {
        display.textContent = "Model failed to load: " + message.message;
        return;
    }

    const isCurrent = message.version === drawingVersion && !currentStroke;
    if (message.type === "preview") {
        if (isCurrent) {
            const preview = document.getElementById("preview");
            preview.width = message.width;
            preview.height = message.height;
            preview.getContext("2d").putImageData(
                new ImageData(message.pixels, message.width, message.height), 0, 0);
        }
        return;
    }

    recognitionBusy = false;
    if (isCurrent) {
        if (message.type === "result") showAnswer(message.latex);
        else display.textContent = "Recognition failed: " + message.message;
    } else {
        scheduleRecognition();
    }
};

worker.onerror = function (event) {
    modelReady = false;
    recognitionBusy = false;
    display.textContent = "Recognition worker failed: " + event.message;
};
