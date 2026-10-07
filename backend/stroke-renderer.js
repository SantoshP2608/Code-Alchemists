// Stroke appearance travels with the vector data, independently of paper layout.
export function applyStrokeStyle(context, stroke) {
    context.strokeStyle = stroke.color || "#252737";
    context.fillStyle = context.strokeStyle;
    context.globalAlpha = stroke.opacity ?? 1;
    context.lineWidth = stroke.lineWidth;
    context.lineCap = "round";
    context.lineJoin = "round";
}

export function renderStroke(context, stroke) {
    const points = stroke.points;
    if (!points.length) return;
    context.save();
    applyStrokeStyle(context, stroke);
    const first = points[0];
    // A marker path is painted once to avoid darker joins while dragging.
    if (points.length === 1 || stroke.tool !== "highlighter") {
        context.beginPath();
        context.arc(first.x, first.y, stroke.lineWidth / 2, 0, Math.PI * 2);
        context.fill();
    }
    if (points.length > 1) {
        context.beginPath();
        context.moveTo(first.x, first.y);
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
    context.restore();
}
