# Infinite canvas update

The drawing surface is now a viewport over an unbounded world. Stroke coordinates
remain in world space, and the bitmap stays the size of the visible canvas.
Offscreen strokes are retained but culled during viewport redraw. Navigation does
not enter drawing history or trigger a new recognition request.

## Controls

- Pencil and Eraser retain their separate remembered sizes.
- Hand tool: drag to pan; also supports touch drag.
- Hold Space and drag, or use the middle mouse button, to pan temporarily.
- Mouse wheel or trackpad scroll pans. Shift + wheel pans horizontally.
- Ctrl/Cmd + wheel or trackpad pinch zooms around the pointer.
- Minus/plus zoom around the viewport center; Home resets the view.
- Undo, Redo and Clear remain below the drawing. Clear removes all ink and remains undoable.
- History in the top right opens a modal panel for the latest 10 calculations.
  Close with its close button, Escape, or a click outside the panel.
- Answers appear beside the ink and travel with it. Loading and errors appear in
  the compact header status, rather than a separate output box.

## Multiple equations on one canvas

Write equations on separate rows or side by side with a clear gap. Nearby strokes
join the same equation; distant strokes start another. After an equation has been
calculated, writing beyond its right edge starts a new equation. Finish each with
`=`. Grouping uses ink geometry, so avoid overlapping equations or extremely tight
spacing. Horizontal tolerance grows with the ink height (1.1 times that height),
with a minimum of 80 and maximum of 240 visible pixels. Large handwriting can
therefore contain wider symbol gaps. Ordinary vertical tolerance remains 18
visible pixels or 35% of the ink height, whichever is larger. A lone flat bar
allows an aligned second bar up to half its width away vertically, capped at 40
visible pixels, so wide equals signs stay together. Tolerances account for zoom
and canvas size. Very distant strokes and writing past a completed equation
continue to start new equations.

Every equation has a stable identity and its own inline answer. Recognition sends
only that equation's strokes to the worker and processes pending equations in
sequence. An edit hides just the affected answer while preserving all previously
evaluated results in history. Each new evaluation appends a separate snapshot,
including repeated expressions. History keeps the latest 10 evaluations and
displays them newest first, independent of the ink currently on the canvas.
Other equations retain their inline answers.

Stroke and pixel erasers preserve equation identity, including pixel fragments.
Undo and Redo restore membership and re-recognize changed equations. Clear removes
all ink and inline answers while preserving calculation history; Undo restores
the ink and calculates its equations again, appending new history entries.
Panning and zooming move every answer with its equation.

## Verification

64 automated tests pass, including world coordinates beyond the initial view,
zoom anchoring and limits, preserved undo/redo and inference during navigation,
answer movement, history opening/closing, brush-size scaling, separate rows, side-by-side equations, evaluation history,
independent delayed replies, erasing and identity restoration. CSS parses and
HTML control identifiers are unique and match the controller.

The automated controller checks use mock browser boundaries; a full browser
preview of this update was not available in the execution environment. Check
layout and real handwriting recognition after running npm run dev locally.
