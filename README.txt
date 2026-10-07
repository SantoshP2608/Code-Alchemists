CalcInk - Draw & Calculate
==========================

Run the browser app
-------------------
Use Node.js 24.12.0 (recorded in .nvmrc and used for verification) and a browser supporting
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
  Drawing undo retains the latest 100 actions. Older ink stays on the canvas,
  but older actions cannot be undone. Redo shares this same history window.
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
Resize and changes in display pixel density preserve logical coordinates.
The canvas follows the current device pixel ratio, including monitor changes.
The preprocessing
preview stays hidden as in the current frontend design. Results and previews
are derived from strokes; they are not independent history actions.

Calculation history
-------------------
Calculated answers also appear beside the trailing = in the drawing area.
If the answer does not fit beside the ink, it appears below it; extra room is
added at the bottom when needed. Answers follow the drawing on resize and
disappear as soon as drawing/history changes invalidate the calculation.
They are display text, so they do not enter stroke history or recognition.
The model returns text without symbol positions; placement uses the rightmost
horizontal strokes as the equals-sign anchor, or the drawing bounds otherwise.

Calculation history keeps the latest 10 evaluated equations and answers as
text, newest first. When full, the oldest entry is removed for the next result.
Incomplete expressions, calculator errors and outdated recognition replies
are not added. Clear and drawing undo/redo do not erase calculation history;
a restored equation that is evaluated again adds another entry. Refreshing
the page resets this history too.

Automated verification
----------------------
The six-point quality audit and its verification limits are documented in
docs/quality-checklist.md.

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
Calculation-history checks cover the 10-entry limit, equation/answer pairing,
retention after Clear, repeated evaluations, errors and outdated replies.
Answer-placement checks cover positioning beside/below the equation, space
at the bottom edge, resizing, stale replies and restoration after Clear.
Quality checks cover fractional and Retina pixel ratios, monitor changes,
the 100-action undo boundary, 1,000 rapid history changes, page teardown,
and inference tensor cleanup on successful and failed recognition.
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
retains at most 100 drawing actions and 10 calculation entries. Memory still
depends on the current drawing's stroke count/complexity and the model runtime.
These limits and cleanup tests are not a guarantee of zero browser/runtime
memory leaks; long-session profiling on target devices is still needed.

The worker explicitly disposes tracked inference tensors after each request,
including errors, and closes after a failed initialization. Page teardown
terminates its worker, disconnects the canvas observer, cancels recognition
timers and removes the pixel-density listener. Browser back/forward cached
pages retain their suspended session so drawings can be restored normally.

Tests simulate touch/pointer cancellation and Cmd shortcuts. Physical touch
and pen devices, native macOS shortcuts, and other browsers need their own
device/browser smoke checks.

Model attribution
-----------------
The pretrained model and vocabulary files are included in models/.
Source: https://github.com/kimseungdae/ink-on
Upstream model: CoMER (ECCV 2022), https://github.com/Green-Wood/CoMER
The ink-on license is included in INK-ON-LICENSE.txt.
