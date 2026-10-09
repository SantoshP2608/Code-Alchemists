# CalcInk merged project

Based on upstream commit 89d5d0d, with the uploaded frontend preserved.

Preserved: TexTeller ONNX migration, tokenizer and preprocessing, model download script, persistent evaluation history, teal notebook theme, logo and background, lattice loader, jelly tool selection, animated history, shiny title, custom eraser menu, editable zoom.

Fixed: empty canvas status after Clear/Undo; startup status remains Loading until both model and calculator are available. Updated tests for visible status messages and zoom input; added typed-zoom and Clear-during-recognition checks.

Validation: all 95 automated tests pass; npm run build passes using downloaded model files. Real browser handwriting inference and visual layout were not exercised here.

## Use

1. Extract this ZIP into a NEW folder. Do not overwrite your original folder or its .git directory.
2. Open Code-Alchemists-merged in VS Code.
3. Run npm ci, then npm run dev. The first run downloads TexTeller assets; internet access is required. The archive excludes node_modules, dist, and downloaded models.
4. Check writing, Clear, erasers, zoom and History in your browser.
5. To upload the merged commit, run git push origin main from this extracted project. If GitHub has received newer changes, fetch and merge those before pushing; do not force push.

The Git history is included; the frontend merge is committed locally. Nothing has been pushed or deployed.

Model files are served locally after download. Offline reload is still not implemented because the project has no service worker.
