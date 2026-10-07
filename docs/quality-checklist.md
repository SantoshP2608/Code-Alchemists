# CalcInk quality checklist

Checked on 7 October 2026 with Node 24.12.0 and npm 11.6.2.
Changes remain local for review.

| Item | Result | Evidence and changes |
| --- | --- | --- |
| High-DPI / Retina scaling | Passed tested ratios | Bitmap size follows device pixel ratio; monitor-density changes trigger a redraw. Tests cover 1, 1.25, 1.5, 2 and 3 without changing logical ink. Same-size callbacks reuse the bitmap. |
| Memory stability | Improved; zero leaks not certified | Drawing history is capped at 100 actions and calculation history at 10. Page teardown cancels its timer, disconnects its observer, removes its density listener and terminates its worker. Inference session tensors are cleaned up on success and error. |
| Reproducibility | Documented workflow checked | Node version recorded in .nvmrc; package-lock.json pins dependencies. Offline npm ci dry-run succeeded. npm test and JavaScript syntax checks passed. |
| Visual elegance | Ready for visual review | Existing dark surfaces, purple accents, rounded controls and responsive layout retained. Added faint paper dots and matched the eraser selector to the 44 px controls. |
| Typography | Checked and refined | Existing system font preserved. Calculation text uses lining and tabular digits; long text can wrap. Browser inspection confirmed these styles and visible keyboard focus. |
| Digital paper aesthetics | Refined | Added CSS-only dot guides and explicit instructions to finish with =. The guides do not enter stroke data, preprocessing or recognition. Answers remain beside = or move below when needed. |

## Verification

- 48 automated tests passed. These include 250 strokes against the 100-action
  history boundary, 1,000 rapid undo/redo cycles, density-listener replacement,
  teardown, worker startup failure, and repeated tensor cleanup on success/error.
- Controlled inference tests left zero undisposed **test tensors** after each
  of 100 successful and 100 failed recognitions. This is not a measurement of
  the browser's entire heap or the native ONNX/WASM runtime.
- The actual browser model calculated a handwritten `1=` and repeatedly
  recalculated it after Clear/Undo. The existing formatter, calculator,
  inline answer and calculation-history flow remained working.
- Default browser DPR 1.25: CSS canvas approximately 912.4 × 405.5 px;
  bitmap 1141 × 507 px, matching rounded CSS dimensions multiplied by DPR.
- At a 390 × 844 viewport, the layout had no horizontal overflow; inline
  answers and history remained readable. Browser warning/error log was empty.

## Practical limits

Memory still scales with current drawing complexity. A Clear action intentionally
retains the previous drawing while it remains undoable; that retained state is
not itself a leak. Model/runtime pools and garbage collection may retain memory
after a calculation. A long-running browser and worker heap profile on target
devices is needed to assess steady-state memory conclusively.

Physical Retina monitors, touch/pen hardware, native macOS shortcuts and a fresh
install on another machine were not tested in this audit. The install check was
a dry-run, not a clean installation. Visual elegance is subjective; review the
updated paper surface before publishing.

To reproduce the automated checks, install Node 24.12.0, then run `npm ci` and
`npm test`. Run `npm run dev` to check the browser app; keep its server running
and use the printed HTTP address rather than opening index.html as a local file.
