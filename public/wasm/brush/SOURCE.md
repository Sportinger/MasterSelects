# Brush browser-training runtime

- Upstream: https://github.com/ArthurBrussee/brush
- Revision: `8b7f5c6c0638892204b540d9aced219f62fc2192`
- License: Apache-2.0 (see `LICENSE`)
- Build: `wasm-pack 0.15.0`, release profile, `web` target

MasterSelects adds one host binding to the generated `brush-js` runtime:
`Training.exportPly()` calls Brush's existing `brush_serde::splat_to_ply`
exporter so a finished in-browser training run can enter the editor's normal
Gaussian-splat media pipeline. The `brush-serde` crate is consequently added
to the `brush-js` build dependencies. No training algorithm is changed.

The generated JavaScript and WASM are loaded only when the user starts GPU
training from the 3D Scan panel; they are not part of the initial app bundle.
