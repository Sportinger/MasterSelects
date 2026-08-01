# Effects.md — audit 2026-08-02

## Verified (spot checks that held)

- The package version is `2.4.4` (`package.json`), and the page's registry totals hold: 34 effects in five non-empty categories (9 color, 5 blur, 7 distort, 12 stylize, 1 keying). Evidence: `src/effects/{color,blur,distort,stylize,keying}/index.ts`, `src/effects/index.ts`.
- The 37 blend modes claim holds: `src/shaders/composite.wgsl` handles modes `0u` through `36u`.
- The registry/category model, fullscreen definition fields, and `particle-render` discriminator are present. Evidence: `src/effects/index.ts`, `src/effects/types.ts`.
- `EffectsTab` is the production visual-effects UI, renders number/boolean/select controls, groups `quality: true` parameters, permits uncapped quality dragging, and supports per-number keyframe controls. Evidence: `src/components/panels/properties/EffectsTab.tsx`.
- Brightness, Contrast, Saturation, and Invert are the inline compositor effects. Evidence: `src/engine/render/layerEffectStack.ts`, `src/engine/pipeline/compositor/uniforms.ts`, `src/shaders/composite.wgsl`.
- The particle effect is registered as `pixel-particle-disintegrate`, has a terminal render-effect split, and the Particle Out preset adds progress keyframes. Evidence: `src/effects/stylize/pixel-particle-disintegrate/index.ts`, `src/engine/render/layerEffectStack.ts`, `src/effects/presets/particleDisintegrateOutro.ts`, `src/components/panels/properties/EffectsTab.tsx`.
- Timeline transitions remain separately registered and capability-gated; planned definitions are not runtime-enabled. Evidence: `src/transitions/index.ts`, `src/transitions/types.ts`, `src/transitions/planned.ts`.
- Feedback effects, continuous rendering, effect keyframing, and Copy/Paste Effects with matching effect keyframes are implemented. Evidence: `src/effects/EffectsPipeline.ts`, `src/effects/index.ts`, `src/components/panels/properties/EffectsTab.tsx`, `src/stores/timeline/clipboardSlice.ts`.

## Outdated or wrong (claim → reality, with file evidence)

- “Pixel Particle Disintegrate: `maxPreviewParticles`, `maxExportParticles`, `maxInstances`, `softness`” are registered quality parameters → `softness` is not marked `quality: true`; only the three budget/limit parameters are. Evidence: `src/effects/stylize/pixel-particle-disintegrate/index.ts`.
- “Effects after [Particle Disintegrate] are reported as unsupported” → they are omitted from rendering and logged as `Ignoring effects after terminal render effect`; there is no Effects-tab status/report for them. Evidence: `src/engine/render/layerEffectStack.ts`, `src/engine/render/Compositor.ts`.
- “Strict worker-gpu-only video presentation does not run the dedicated particle pass yet” → worker-GPU paths pass preview/export `particleQuality` into the compositor, which invokes `PixelParticleDisintegrateRenderer`. Evidence: `src/services/render/workerGpuFrameStackExecutor.ts`, `src/services/render/workerGpuVideoFrameCompositor.ts`, `src/engine/render/Compositor.ts`.
- “The pipeline creates one GPU render pipeline per registered effect” → it deliberately skips the four inline effects and every non-fullscreen definition, including the particle render effect. Evidence: `src/effects/EffectsPipeline.ts`, `src/effects/types.ts`.

## Noteworthy / unusual

- Motion-adjustment clips expose only five safe visual effects in the production picker; unsupported adjustment effects are skipped in preview and throw during export. Evidence: `src/components/panels/properties/EffectsTab.tsx`, `src/engine/render/Compositor.ts`, `src/services/motionDesign/adjustment/supportedEffects.ts`.
- `passes` remains declared on fullscreen effect definitions, but no registered effect sets it and `src/effects/EffectsPipeline.ts` does not consume it. `customControls` is only used by the legacy generic `src/effects/EffectControls.tsx`, not by `EffectsTab`.
- `generate`, `time`, and `transition` remain empty effect-category modules, but the separate transition registry contains both stable and planned timeline transitions. Evidence: `src/effects/{generate,time,transition}/index.ts`, `src/transitions/index.ts`, `src/transitions/planned.ts`.
