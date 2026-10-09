# CalcInk merged project

Based on upstream commit 89d5d0d, with the uploaded frontend preserved.

Preserved: TexTeller ONNX migration, tokenizer and preprocessing, model download script, persistent evaluation history, teal notebook theme, logo and background, lattice loader, jelly tool selection, animated history, shiny title, custom eraser menu, editable zoom.

Fixed: empty canvas status after Clear/Undo; startup status remains Loading until both model and calculator are available. Updated tests for visible status messages and zoom input; added typed-zoom and Clear-during-recognition checks.

Validation of merge commit b6ae6c0: all 95 automated tests and the production build passed. Chrome verified model startup, a drawn `1=`, history retention after Clear, the custom eraser selector, editable zoom, and mobile layout without horizontal overflow.

## Use

1. Clone the repository, or update a clean existing checkout using `git pull --ff-only`.
2. Open the project folder in VS Code.
3. Run npm ci, then npm run dev. The first run downloads TexTeller assets; internet access is required. Generated dependencies, build output and downloaded models are excluded from Git.
4. Check writing, Clear, erasers, zoom and History in your browser.
5. Commit and push new changes from your checkout. Fetch and integrate newer remote changes before pushing; do not force push.

The frontend merge has been pushed to the repository's `main` branch as b6ae6c0. Production deployment status was not checked in this review.

Model files are served locally after download. Offline reload is still not implemented because the project has no service worker.
