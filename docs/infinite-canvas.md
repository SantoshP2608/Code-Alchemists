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

Recognition still uses the existing current-drawing pipeline. This change does
not introduce separate recognition or retained answers for multiple equations.

## Verification

56 automated tests pass, including world coordinates beyond the initial view,
zoom anchoring and limits, preserved undo/redo and inference during navigation,
answer movement, history opening/closing, and brush-size scaling. CSS parses and
HTML control identifiers are unique and match the controller.

The automated controller checks use mock browser boundaries; a full browser
preview of this update was not available in the execution environment. Check
layout and real handwriting recognition after running npm run dev locally.
