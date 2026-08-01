# Flex-EQ-Visual-QA.md — audit 2026-08-02

## Verified (spot checks that held)

- The `?test=flex-eq` dev route is lazy-loaded in `src/App.tsx` and renders `src/test/FlexEqVisualQa.tsx`.
- The QA page creates four deterministic fixtures in `src/engine/audio/eq/AudioEqVisualFixtures.ts`: 10-band graphic, parametric, mastering/dynamic, and compact insert. The mastering fixture enables both dynamic and spectral-dynamics band data and selects/solos the spectral band.
- The graph renderer draws spectral-dynamics ranges and represents Band Solo state in `src/components/panels/properties/flexEqualizer/canvasRenderer.ts`; Sketch, Grab, and Match controls are implemented by `src/components/panels/properties/FlexEqualizerControl.tsx` and `flexEqualizer/UtilityStrip.tsx`.
- The image path, manifest entry, route, output path, and `npm run docs:screenshots -- --id=flex-eq-visual-qa` command agree across `docs/Features/assets/docs-screenshot-manifest.json`, `scripts/capture-feature-doc-screenshots.mjs`, and `package.json`.
- The screenshot runner verifies the dev server and launches a supported headless browser. `scripts/capture-feature-doc-screenshots.mjs` provides Edge/Chrome candidates on Windows and Edge/Chrome/Chromium candidates on macOS/Linux.

## Outdated or wrong (claim → reality, with file evidence)

- “It renders … the preset browser surface” → The default QA grid renders the **Presets** button, but the browser panel starts closed (`showPresetBrowser` is initialized to `false`) and opens only after interaction. Evidence: `src/components/panels/properties/flexEqualizer/useFlexEqualizerPresetBrowser.ts` and `src/components/panels/properties/flexEqualizer/UtilityStrip.tsx`; the committed screenshot `docs/Features/assets/flex-eq/flex-eq-visual-qa.png` likewise shows the button, not the panel.
- “Use a taller `window.height` … when checking the full fixture grid” → The checked manifest already specifies a 1280x1320 viewport for this shot, and the committed 1280x1320 image contains all four cards. Evidence: `docs/Features/assets/docs-screenshot-manifest.json` and `docs/Features/assets/flex-eq/flex-eq-visual-qa.png`.

## Noteworthy / unusual

- The route is independent of project data because `FlexEqVisualQa` owns fixture parameters in React state, but opening its preset browser reads browser-local saved presets and favorites through `src/services/audio/audioEqPresetStorage.ts`; “does not depend on project state” should not be read as a fully storage-free route.
- The QA page exercises the same exported `FlexEqualizerControl` used by both `src/components/panels/properties/AudioEffectStackControl.tsx` and `src/components/panels/properties/VolumeTab.tsx`, rather than a test-only EQ renderer.
- The historical full-scope plan is explicitly a completed archive (`docs/completed/plans/flex-eq-full-scope-plan.md`), while the feature documentation had no current version marker before this refresh. `package.json` reports version `2.4.4`.
