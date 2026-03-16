# Domain 5: Effects & Transitions - Reviewer A Findings

## Summary
- Files audited: 42 (30 effect index.ts files, 8 category index.ts files, EffectsPipeline.ts, EffectControls.tsx, EffectsTab.tsx, types.ts, common.wgsl, 3 transition files, performanceMonitor.ts)
- Docs reviewed: 2 (docs/Features/Effects.md, docs/Features/effects-system.md)
- Critical gaps found: 1
- Inaccuracies found: 7
- Missing features: 0 (no changes after 2026-03-08)

## Complete Effect Inventory

### Color Correction (9 effects)
| # | Effect | ID | Params | Uniform Size |
|---|--------|----|--------|-------------|
| 1 | Brightness | `brightness` | amount (1 param) | 16 bytes |
| 2 | Contrast | `contrast` | amount (1 param) | 16 bytes |
| 3 | Saturation | `saturation` | amount (1 param) | 16 bytes |
| 4 | Vibrance | `vibrance` | amount (1 param) | 16 bytes |
| 5 | Hue Shift | `hue-shift` | shift (1 param) | 16 bytes |
| 6 | Temperature | `temperature` | temperature, tint (2 params) | 16 bytes |
| 7 | Exposure | `exposure` | exposure, offset, gamma (3 params) | 16 bytes |
| 8 | Levels | `levels` | inputBlack, inputWhite, gamma, outputBlack, outputWhite (5 params) | 32 bytes |
| 9 | Invert | `invert` | (none) | 0 bytes |

### Blur Effects (5 effects)
| # | Effect | ID | Params | Uniform Size |
|---|--------|----|--------|-------------|
| 10 | Box Blur | `box-blur` | radius (1 param) | 16 bytes |
| 11 | Gaussian Blur | `gaussian-blur` | radius, samples* (2 params) | 16 bytes |
| 12 | Motion Blur | `motion-blur` | amount, angle, samples* (3 params) | 16 bytes |
| 13 | Radial Blur | `radial-blur` | amount, centerX, centerY, samples* (4 params) | 16 bytes |
| 14 | Zoom Blur | `zoom-blur` | amount, centerX, centerY, samples* (4 params) | 16 bytes |

### Distort Effects (7 effects)
| # | Effect | ID | Params | Uniform Size |
|---|--------|----|--------|-------------|
| 15 | Pixelate | `pixelate` | size (1 param) | 16 bytes |
| 16 | Kaleidoscope | `kaleidoscope` | segments, rotation (2 params) | 16 bytes |
| 17 | Mirror | `mirror` | horizontal, vertical (2 boolean params) | 16 bytes |
| 18 | RGB Split | `rgb-split` | amount, angle (2 params) | 16 bytes |
| 19 | Twirl | `twirl` | amount, radius, centerX, centerY (4 params) | 16 bytes |
| 20 | Wave | `wave` | amplitudeX, amplitudeY, frequencyX, frequencyY (4 params) | 16 bytes |
| 21 | Bulge/Pinch | `bulge` | amount, radius, centerX, centerY (4 params) | 16 bytes |

### Stylize Effects (8 effects)
| # | Effect | ID | Params | Uniform Size |
|---|--------|----|--------|-------------|
| 22 | Vignette | `vignette` | amount, size, softness, roundness (4 params) | 16 bytes |
| 23 | Film Grain | `grain` | amount, size, speed (3 params) | 16 bytes |
| 24 | Glow | `glow` | amount, threshold, radius, softness, rings*, samplesPerRing* (6 params) | 32 bytes |
| 25 | Posterize | `posterize` | levels (1 param) | 16 bytes |
| 26 | Edge Detect | `edge-detect` | strength, invert (2 params) | 16 bytes |
| 27 | Scanlines | `scanlines` | density, opacity, speed (3 params) | 16 bytes |
| 28 | Threshold | `threshold` | level (1 param) | 16 bytes |
| 29 | Sharpen | `sharpen` | amount, radius (2 params) | 16 bytes |

### Keying Effects (1 effect)
| # | Effect | ID | Params | Uniform Size |
|---|--------|----|--------|-------------|
| 30 | Chroma Key | `chroma-key` | keyColor, tolerance, softness, spillSuppression (4 params) | 32 bytes |

**Total: 30 effects across 5 active categories (generate, time, transition categories are empty/reserved)**

### Transitions (1 registered)
| # | Transition | ID | Category | Default Duration |
|---|------------|-----|----------|-----------------|
| 1 | Crossfade | `crossfade` | dissolve | 0.5s (0.1-5.0s range) |

## Gap Analysis

### Undocumented Effects
No effects found in code that are absent from documentation. Both doc files correctly list all 30 effects.

### Inaccurate Documentation

#### 1. CRITICAL: `EffectControls.tsx` does not separate quality params (Effects.md mismatch)
- **Location**: `docs/Features/Effects.md` lines 187-214, `docs/Features/effects-system.md` line implied
- **Issue**: The docs describe the "Quality" section UI (collapsible, reset button, no upper limit when dragging, warning about slowdowns). This behavior is actually implemented in `src/components/panels/properties/EffectsTab.tsx`, NOT in `src/effects/EffectControls.tsx`. The `EffectControls.tsx` file is a simpler generic renderer that does NOT implement the quality section separation, collapsible UI, or noMaxLimit behavior. The `effects-system.md` doc (line 12) references `EffectControls.tsx` as the "Generic UI renderer" which is technically true but misleading since the actual production UI comes from `EffectsTab.tsx`.
- **Impact**: A developer reading the docs would look at `EffectControls.tsx` for the quality UI implementation and not find it.

#### 2. Uniform buffer size range stated as "16-32 bytes" is incomplete
- **Location**: `docs/Features/Effects.md` line 289 - "Uniform buffer (16-32 bytes, 16-byte aligned)"
- **Issue**: While the claim is accurate (effects use either 16 or 32 bytes), stating "16-32" could mislead. More precisely: 28 out of 30 effects use 16 bytes, Levels and Glow use 32 bytes, and Invert uses 0 bytes (no uniform buffer at all). The "0 bytes" case is not mentioned.
- **Suggested fix**: Change to "Uniform buffer (0, 16, or 32 bytes, 16-byte aligned)"

#### 3. `EffectControls.tsx` has unimplemented `point` parameter type
- **Location**: `src/effects/EffectControls.tsx` line 150-155
- **Code**: The `point` type case renders `<span>Point control (TODO)</span>`
- **Issue**: `docs/Features/effects-system.md` lists `point` as a supported parameter type with "XY controls" as the UI Control (line 204), but the implementation is a TODO placeholder. No current effects use the `point` type, so this has no runtime impact, but the documentation implies it is functional.
- **Impact**: Low - no effects use this type yet.

#### 4. Docs claim Invert has "(no params)" but code says `(none)` vs `{}` discrepancy is trivial
- **Not an issue**: Both docs correctly state Invert has no parameters. This is accurate.

#### 5. Missing default values in Effects.md parameter tables
- **Location**: `docs/Features/Effects.md` Color Correction table (lines 138-148)
- **Issue**: The Effects.md parameter tables only show parameter name and range but do NOT show default values for most effects. The `effects-system.md` also omits defaults for many effects. Specific defaults that differ from what a user might assume:
  - Brightness: default 0 (correct - neutral)
  - Contrast: default 1 (correct - neutral)
  - Saturation: default 1 (correct - neutral)
  - Hue Shift: default 0 (correct)
  - Box Blur: default radius 5 (not documented in Effects.md)
  - Gaussian Blur: default radius 10 (not documented in Effects.md)
  - Motion Blur: default amount 0.05 (not documented)
  - Radial Blur: default amount 0.5 (not documented)
  - Zoom Blur: default amount 0.3 (not documented)
  - Pixelate: default size 8 (not documented)
  - Kaleidoscope: default segments 6 (not documented)
  - Twirl: default amount 1 (not documented)
  - Wave: default amplitudeX/Y 0.02, frequencyX/Y 5 (not documented)
  - Bulge: default amount 0.5, radius 0.5 (not documented)
  - Vignette: default amount 0.5, size 0.5, softness 0.5, roundness 1 (not documented)
  - Grain: default amount 0.1, size 1, speed 1 (not documented)
  - Glow: default amount 1, threshold 0.6, radius 20, softness 0.5 (not documented)
  - Posterize: default levels 6 (not documented)
  - Edge Detect: default strength 1, invert false (not documented)
  - Scanlines: default density 5, opacity 0.3, speed 0 (not documented)
  - Sharpen: default amount 1, radius 1 (not documented)
  - Threshold: default level 0.5 (not documented)
  - Chroma Key: default tolerance 0.2, softness 0.1, spillSuppression 0.5 (not documented)
- **Note**: `effects-system.md` includes defaults for quality params (samples) but not for the main params. Neither doc consistently provides defaults.

#### 6. `effects-system.md` says `EffectControls.tsx` is the "Generic UI renderer" but real UI is `EffectsTab.tsx`
- **Location**: `docs/Features/effects-system.md` line 13 in architecture diagram
- **Issue**: The architecture tree shows `EffectControls.tsx` as the "Generic UI renderer". While `EffectControls.tsx` does exist and provides a basic generic renderer, the actual production UI used in the Properties Panel is `src/components/panels/properties/EffectsTab.tsx`. This file uses `DraggableNumber`, `EffectKeyframeToggle`, batch grouping via `startBatch`/`endBatch`, and the collapsible Quality section.
- **Impact**: Medium - leads developers to the wrong file when looking for UI code.

#### 7. `rgb-split` default amount is 0.01 in code but not explicitly stated in docs
- **Location**: `docs/Features/Effects.md` line 165 - "amount (0-0.1)"
- **Issue**: The range is correctly documented, but no default value given. Code default is 0.01.
- **Impact**: Low.

### Missing Features (post-2026-03-08)
No changes to `src/effects/` or `src/transitions/` have been committed since March 8, 2026 (verified via git log across all branches). The codebase matches the state as of the documentation baseline.

### Stale References

#### 1. Effect count "30" is accurate
- `Effects.md` header says "30 shader effects" (line 5) - **CORRECT**
- `effects-system.md` header says "Registered Effects (30)" (line 39) - **CORRECT**
- Code confirms exactly 30 effects: 9 color + 5 blur + 7 distort + 8 stylize + 1 keying = 30

#### 2. Category count is accurate
- 5 active categories with effects, 3 reserved empty categories (generate, time, transition)
- Both docs correctly reflect this

#### 3. Blend mode count "37" is accurate
- `Effects.md` says "37 Blend Modes" - present in docs but not verified here (blend modes are in composite shader, not effects directory)

#### 4. Transition categories include `slide` and `zoom` in code but docs only mention dissolve and wipe
- **Location**: `src/transitions/types.ts` line 6 defines `TransitionCategory = 'dissolve' | 'wipe' | 'slide' | 'zoom'`
- **Issue**: `Effects.md` planned transitions section (lines 303-306) mentions "Dip to Black (dissolve), Dip to White (dissolve), Wipe Left (wipe), Wipe Right (wipe)" but does NOT mention `slide` and `zoom` as available transition categories.
- **Impact**: Low - these are empty categories, but should be documented for completeness.

### Documentation Quality Issues

#### 1. Duplicated content between the two docs
- `Effects.md` and `effects-system.md` contain significant overlap (both list all 30 effects with parameters, both describe the pipeline, both describe the effect definition interface). They have slightly different perspectives - `Effects.md` is user-facing and `effects-system.md` is developer-facing - but this creates maintenance burden and inconsistency risk.

#### 2. `effects-system.md` shared shader utilities list is accurate but incomplete
- **Location**: `docs/Features/effects-system.md` lines 232-237
- **Issue**: The list mentions `rgb2hsv()`, `hsv2rgb()`, `rgb2hsl()`, `hsl2rgb()`, `hue2rgb()`, `luminance()`, `luminance601()`, `gaussian()`, `smootherstep()`, `hash()`, `noise2d()`, plus `PI`, `TAU`, `E`. This matches the actual `common.wgsl` file exactly. **No issue here - accurate.**

#### 3. Inline effects set is correctly documented
- `EffectsPipeline.ts` line 12: `INLINE_EFFECT_IDS = new Set(['brightness', 'contrast', 'saturation', 'invert'])`
- `Effects.md` lines 231-234 correctly lists these four effects as inline. **Accurate.**

#### 4. `EffectControls.tsx` vs `EffectsTab.tsx` creates confusion
- The codebase has TWO effect control renderers:
  1. `src/effects/EffectControls.tsx` - basic generic renderer (uses plain `<input type="range">`)
  2. `src/components/panels/properties/EffectsTab.tsx` - production renderer (uses `DraggableNumber`, `PrecisionSlider`, batch grouping, quality sections)
- The docs reference both files in different places but never clarify which one is the primary UI component. The `EffectControls.tsx` appears to be a legacy/fallback component that is not used in the main application flow.

#### 5. `ClipTransition` interface not documented
- `src/transitions/types.ts` defines `ClipTransition` interface (id, type, duration, linkedClipId) which describes how transitions are stored on clips. Neither doc mentions this runtime representation.

#### 6. Performance protection feature has no dedicated docs section
- `Effects.md` lines 216-221 correctly document the auto-reset behavior (100ms threshold, 5 consecutive frames). The implementation in `src/services/performanceMonitor.ts` matches (SLOW_FRAME_THRESHOLD_MS=100, CONSECUTIVE_SLOW_FRAMES=5). **Accurate.**

## Recommended Changes

### Priority 1 (Critical)
1. **Clarify EffectControls.tsx vs EffectsTab.tsx roles**: Update `effects-system.md` architecture diagram to reference `EffectsTab.tsx` as the primary production UI, and note that `EffectControls.tsx` is a simplified/generic fallback renderer.

### Priority 2 (High)
2. **Add default values to Effects.md**: The parameter tables in Effects.md should include a "Default" column for all effects. The `effects-system.md` includes defaults for quality params only; it should also include defaults for all main parameters.
3. **Document `point` type as unimplemented**: Add a note in `effects-system.md` that the `point` parameter type is defined but not yet implemented in the UI (renders as TODO placeholder).

### Priority 3 (Medium)
4. **Correct uniform size documentation**: Change "16-32 bytes" to "0, 16, or 32 bytes" to account for the Invert effect which has no uniforms.
5. **Document `slide` and `zoom` transition categories**: Add these to the planned transitions documentation in Effects.md.
6. **Document `ClipTransition` interface**: Add the runtime transition instance structure to the transitions section.

### Priority 4 (Low)
7. **Consider consolidating or clearly differentiating the two doc files**: `Effects.md` should be purely user-facing (UI behavior, usage instructions), while `effects-system.md` should be developer-facing (architecture, code patterns, adding new effects). Currently they overlap significantly.
8. **Add `rgb-split` default (0.01) and other defaults to docs**: For completeness in both parameter tables.
