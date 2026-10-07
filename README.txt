CalcInk - Draw & Calculate
==========================

Run the browser app
-------------------
Use Node.js 24 (the version used for verification) and a browser supporting
Pointer Events, ResizeObserver, Web Workers, OffscreenCanvas and WebAssembly.
From this project folder, run:

    npm ci
    npm run dev

Open http://localhost:5173/frontend/index.html (or the address printed by Vite).
Keep the server running while using CalcInk. Do not double-click index.html or
open a C:/... or file:// address: module workers and model assets need HTTP.
Vite opens /frontend/index.html. Wait for "Handwriting model ready", then draw
a single-line arithmetic expression ending in =, for example 1+1=.
Recognition is scheduled 600 ms after the last stroke or history change;
inference can take additional time, especially on the first drawing.

Recognition runs in a browser worker and calculation uses the bundled WASM
module. A Python or Flask server is not needed for the active app.
frontend/index.html loads backend/app.js. frontend/script.js is an unused
older implementation; it is not the place to change the drawing behavior.

Drawing and history controls
----------------------------
- Draw with a mouse, pen, or one primary touch pointer. A dot is a stroke.
- Pencil and Eraser retain their own Size settings. Use the vertical slider
  for pencil thickness or eraser diameter; changing tools or size is not a
  history action and does not discard redo.
- Stroke eraser removes whole touched strokes. Pixel eraser removes portions
  of strokes and keeps the remaining fragments separate.
- A complete eraser drag is one undoable action, even if it touches several
  strokes. Undo restores the original ink and widths; Redo restores the exact
  erased result. Erasing empty space does not add history or discard redo.
- Undo: use the Undo button or Ctrl+Z / Cmd+Z.
- Redo: use the Redo button or Ctrl+Shift+Z / Cmd+Shift+Z.
  Ctrl+Y also performs redo on Windows.
- Clear: removes the whole drawing as one undoable action. Undo restores all
  its strokes, and Redo clears them again.
- Clear on an empty canvas does nothing and preserves redo history.
- A new completed stroke, an eraser drag that changes ink, or a nonempty Clear
  discards redo history.
- Undo and Redo are disabled during drawing/erasing and at history boundaries.
- Clear during drawing finishes the visible partial stroke, releases pointer
  capture, and clears it with the rest. Undo restores the partial stroke too.
- Clear during erasing finishes the eraser action first. Undo Clear restores
  the visible remaining ink; another Undo restores the ink erased by that drag.
- Pointer cancellation/capture loss finishes the visible stroke once.
- Shortcuts leave editable fields alone. Tab and Shift+Tab move between
  enabled buttons, with a visible focus outline.
- Touch gestures on the drawing canvas draw rather than scroll the page;
  normal scrolling remains available outside the canvas.

History stores stroke data in memory for the current page session. Refreshing
the page resets it. History changes clear the previous answer and recognition
preview, reject outdated worker replies, and recognize the restored drawing.
Resize preserves the drawing in its logical coordinates. The preprocessing
preview stays hidden as in the current frontend design. Results and previews
are derived from strokes; they are not independent history actions.

Automated verification
----------------------
Run all tests from the project folder:

    npm test

Run selected checks, for example worker-response and readiness tests:

    node --experimental-vm-modules --test --test-name-pattern="recognition|readiness|reply" tests/app-history.test.js

The tests exercise the real drawing controller with controlled DOM/canvas,
timer and worker boundaries. They cover strokes and dots, undo/redo boundaries,
branching after undo, undoable/repeated Clear, shortcuts and editable targets,
pointer cancellation/capture loss, Clear during drawing, resizing, delayed
model/calculator startup, recognition errors, and stale/duplicate replies.
They also cover pencil widths/tool settings, both eraser modes, whole-gesture
erase history, no-op erasing, fragment restoration, Clear during erasing and
recognition requests after eraser undo/redo.
The pipeline test uses the real LaTeX formatter and bundled evaluate.wasm to
check that restored stroke data can produce calculations such as 2*3=6.
Controlled worker replies make history tests independent of recognition speed
and handwriting accuracy. No model download or running server is required.
Node prints an experimental VM Modules warning; the test runner enables that
API to load the browser controller with its controlled dependencies.

Browser smoke check
-------------------
1. Draw several strokes and a dot. Undo to empty, then redo to the full drawing.
2. Undo once and draw something new; Redo must become unavailable.
3. Clear twice, then undo once; the full drawing must return. Redo clears it.
4. Check the keyboard shortcuts, Tab focus and disabled button states.
5. Resize after undo, redo and Clear restoration; strokes must retain position.
6. Draw an equation ending in = and wait for its answer. Clear and undo Clear;
   the restored equation must be recognized and calculated again.
7. Change history rapidly during recognition; older answers/previews must not
   replace the latest state. An empty drawing must remain empty.
8. On a touch device, check drawing without page scrolling and Clear from a
   second pointer while a stroke is active. Later events must not revive it.
9. In Stroke mode, erase several strokes in one drag; one Undo restores them
   all. In Pixel mode, cut a gap, undo it, then redo; the gap must stay open.
10. Change tool and size after undo, or erase empty space; redo stays available.

Limitations and recovery
------------------------
Recognition accuracy depends on the handwriting and model; history tests do
not guarantee recognition of every expression. A normal inference error is
reported and a later edit/history change can try again. If model/calculator
startup or the worker itself fails, drawing/history remain available; reload
the page to restart the pipeline. History is not saved across refreshes and
has no fixed memory cap, so very long sessions retain their stroke data.

Tests simulate touch/pointer cancellation and Cmd shortcuts. Physical touch
and pen devices, native macOS shortcuts, and other browsers need their own
device/browser smoke checks.

Model attribution
-----------------
The pretrained model and vocabulary files are included in models/.
Source: https://github.com/kimseungdae/ink-on
Upstream model: CoMER (ECCV 2022), https://github.com/Green-Wood/CoMER
The ink-on license is included in INK-ON-LICENSE.txt.
