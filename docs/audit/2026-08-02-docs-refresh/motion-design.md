# Motion-Design.md — audit 2026-08-02

## Verified (spot checks that held)

- The motion schema defines `shape`, `null`, `adjustment`, and `group` layer kinds, and the timeline accepts `motion-shape`, `motion-null`, and `motion-adjustment`: `src/types/motionDesign.ts`; `src/stores/timeline/motionClipSlice.ts`.
- Shape primitives, ordered appearances, stable appearance/gradient-stop ids, the eight-item/eight-stop shader limits, and the six advertised appearance blend modes are implemented: `src/types/motionDesign.ts`; `src/components/panels/properties/MotionAppearanceStackEditor.tsx`; `src/engine/motion/MotionBuffers.ts`; `src/engine/motion/shaders/motionShapes.wgsl`.
- The shared Motion renderer, property registry/keyframe path, Graph mode, Motion Path overlay, and direct/nested/export routes remain present: `src/engine/motion/MotionRenderer.ts`; `src/services/properties/PropertyRegistry.ts`; `src/components/preview/MotionPathOverlay.tsx`; `src/services/layerBuilder/layerBuilderMotionLayers.ts`.
- `getMotionCapabilities` still reports capability version 2, and `addKeyframe` remains a registered Motion Design tool path: `src/services/motionDesign/mvpCapabilities.ts`; `src/services/aiTools/definitions/motionDesign.ts`.

## Outdated or wrong (claim → reality, with file evidence)

- “MD0-MD2 are complete” and the MD3/MD6/MD7-start language → MD3 through MD8 are closed; only MD9 release hardening remains open: `docs/plans/motion-design-md3-md9-execution-plan.md`; `docs/evidence/motion-design/md3-replicator-core.md`; `docs/evidence/motion-design/md4-modifiers-falloffs.md`; `docs/evidence/motion-design/md5-media-motion.md`; `docs/evidence/motion-design/md6-structure.md`; `docs/evidence/motion-design/md7-adjustment-render-graph.md`; `docs/evidence/motion-design/md8-presets-templates-expressions.md`.
- “Grid MVP ... capped at 100 instances” → Grid, Linear, and Radial layouts use cached instance buffers; the runtime cap is 100,000 and layers retain a `userLimit`: `src/types/motionDesign.ts`; `src/engine/motion/MotionTypes.ts`; `src/engine/motion/MotionRenderer.ts`; `src/services/motionDesign/mvpCapabilities.ts`.
- “No random/noise modifiers, radial/linear layouts, falloff, or direct media” → Random, Noise, Oscillator, and radial Field modifiers, rectangle/ellipse falloffs, and all three layouts are implemented; only direct-media replicators remain deferred: `src/services/motionDesign/modifiers/contracts.ts`; `src/components/panels/properties/MotionModifiersSection.tsx`; `src/types/motionDesign.ts`; `docs/evidence/motion-design/md4-modifiers-falloffs.md`.
- “Texture fills ... deferred” → image and frozen-video texture fills are authorable in the UI and AI, with one decoded frame per reuse key; presets intentionally reject them: `src/components/panels/properties/MotionAppearanceStackEditor.tsx`; `src/engine/motion/MotionRenderer.ts`; `src/engine/motion/media/motionTextureAcquisition.ts`; `docs/evidence/motion-design/md5-media-motion.md`.
- “Adjustment layers remain blocked” → the compositor path and `editMotionAdjustment` are live; supported effects are Brightness, Contrast, Saturation, Invert, and Gaussian Blur: `src/services/layerBuilder/layerBuilderMotionAdjustment.ts`; `src/services/motionDesign/adjustment/supportedEffects.ts`; `src/services/aiTools/definitions/motionDesign.ts`; `docs/evidence/motion-design/md7-adjustment-render-graph.md`.
- “The six Motion Design AI tools” → 18 tool definitions are registered: `src/services/aiTools/definitions/motionDesign.ts`.

## Noteworthy / unusual

- `MotionLayerKind` still reserves `group`, but the frozen structure contract explicitly says groups are unsupported: `src/types/motionDesign.ts`; `docs/evidence/motion-design/md6-structure.md`.
- The renderer accepts up to eight texture-fill appearances in input but can bind and render only the first; later texture fills produce a diagnostic: `src/engine/motion/MotionRenderer.ts`.
- MD5 evidence records two real-GPU defects that unit tests did not catch, including a shader dispatch that made all motion shapes invisible; it recommends a live pixel check after WGSL changes: `docs/evidence/motion-design/md5-media-motion.md`.
- The former active AI-completion plan still shows MD3-MD8 unchecked, while the newer MD3-MD9 execution plan and phase evidence mark them closed: `docs/plans/motion-design-ai-completion-plan.md`; `docs/plans/motion-design-md3-md9-execution-plan.md`.
- MD8 evidence records that templates do not yet capture expressions despite the MD8 gate being closed: `docs/evidence/motion-design/md8-presets-templates-expressions.md`.
