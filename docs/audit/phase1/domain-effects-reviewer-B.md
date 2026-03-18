# Domain 5: Effects & Transitions - Reviewer B Findings

## Summary
- Files audited: 42 (30 effect index.ts files, 5 category index.ts files, effects/index.ts, effects/types.ts, EffectsPipeline.ts, EffectControls.tsx, EffectsTab.tsx, _shared/common.wgsl, 3 transition files)
- Docs reviewed: 2 (docs/Features/Effects.md, docs/Features/effects-system.md)
- Critical gaps found: 1
- Inaccuracies found: 8
- Missing features: 0 (no recent changes since 2026-03-08)

## Complete Effect Inventory (from code)

### Color Correction (9 effects)
| Category | Effect | ID | Parameters (name: default, min-max) | In Effects.md? | In effects-system.md? |
|----------|--------|----|--------------------------------------|----------------|----------------------|
| color | Brightness | `brightness` | amount: 0, -1 to 1 | Yes | Yes |
| color | Contrast | `contrast` | amount: 1, 0 to 3 | Yes | Yes |
| color | Saturation | `saturation` | amount: 1, 0 to 3 | Yes | Yes |
| color | Vibrance | `vibrance` | amount: 0, -1 to 1 | Yes | Yes |
| color | Hue Shift | `hue-shift` | shift: 0, 0 to 1 | Yes | Yes |
| color | Temperature | `temperature` | temperature: 0, -1 to 1; tint: 0, -1 to 1 | Yes | Yes |
| color | Exposure | `exposure` | exposure: 0, -3 to 3; offset: 0, -0.5 to 0.5; gamma: 1, 0.2 to 3 | Yes | Yes |
| color | Levels | `levels` | inputBlack: 0, 0-1; inputWhite: 1, 0-1; gamma: 1, 0.1-3; outputBlack: 0, 0-1; outputWhite: 1, 0-1 | Yes | Yes |
| color | Invert | `invert` | (none) | Yes | Yes |

### Blur Effects (5 effects)
| Category | Effect | ID | Parameters (name: default, min-max) | In Effects.md? | In effects-system.md? |
|----------|--------|----|--------------------------------------|----------------|----------------------|
| blur | Box Blur | `box-blur` | radius: 5, 0-20 | Yes | Yes |
| blur | Gaussian Blur | `gaussian-blur` | radius: 10, 0-50; samples*: 5, 1-64 | Yes | Yes |
| blur | Motion Blur | `motion-blur` | amount: 0.05, 0-0.3; angle: 0, 0-TAU; samples*: 24, 4-128 | Yes | Yes |
| blur | Radial Blur | `radial-blur` | amount: 0.5, 0-2; centerX: 0.5, 0-1; centerY: 0.5, 0-1; samples*: 32, 4-256 | Yes | Yes |
| blur | Zoom Blur | `zoom-blur` | amount: 0.3, 0-1; centerX: 0.5, 0-1; centerY: 0.5, 0-1; samples*: 16, 4-256 | Yes | Yes |

### Distort Effects (7 effects)
| Category | Effect | ID | Parameters (name: default, min-max) | In Effects.md? | In effects-system.md? |
|----------|--------|----|--------------------------------------|----------------|----------------------|
| distort | Pixelate | `pixelate` | size: 8, 1-64 | Yes | Yes |
| distort | Kaleidoscope | `kaleidoscope` | segments: 6, 2-16; rotation: 0, 0-TAU | Yes | Yes |
| distort | Mirror | `mirror` | horizontal: true (bool); vertical: false (bool) | Yes | Yes |
| distort | RGB Split | `rgb-split` | amount: 0.01, 0-0.1; angle: 0, 0-TAU | Yes | Yes |
| distort | Twirl | `twirl` | amount: 1, -10 to 10; radius: 0.5, 0.1-1; centerX: 0.5, 0-1; centerY: 0.5, 0-1 | Yes | Yes |
| distort | Wave | `wave` | amplitudeX: 0.02, 0-0.1; amplitudeY: 0.02, 0-0.1; frequencyX: 5, 1-20; frequencyY: 5, 1-20 | Yes | Yes |
| distort | Bulge/Pinch | `bulge` | amount: 0.5, 0.1-3; radius: 0.5, 0.1-1; centerX: 0.5, 0-1; centerY: 0.5, 0-1 | Yes | Yes |

### Stylize Effects (8 effects)
| Category | Effect | ID | Parameters (name: default, min-max) | In Effects.md? | In effects-system.md? |
|----------|--------|----|--------------------------------------|----------------|----------------------|
| stylize | Vignette | `vignette` | amount: 0.5, 0-1; size: 0.5, 0-1.5; softness: 0.5, 0-1; roundness: 1, 0.5-2 | Yes | Yes |
| stylize | Film Grain | `grain` | amount: 0.1, 0-0.5; size: 1, 0.5-5; speed: 1, 0-5 | Yes | Yes |
| stylize | Glow | `glow` | amount: 1, 0-5; threshold: 0.6, 0-1; radius: 20, 1-100; softness: 0.5, 0.1-1; rings*: 4, 1-32; samplesPerRing*: 16, 4-64 | Yes | Yes |
| stylize | Posterize | `posterize` | levels: 6, 2-32 | Yes | Yes |
| stylize | Edge Detect | `edge-detect` | strength: 1, 0-5; invert: false (bool) | Yes | Yes |
| stylize | Scanlines | `scanlines` | density: 5, 1-20; opacity: 0.3, 0-1; speed: 0, 0-5 | Yes | Yes |
| stylize | Threshold | `threshold` | level: 0.5, 0-1 | Yes | Yes |
| stylize | Sharpen | `sharpen` | amount: 1, 0-5; radius: 1, 0.5-5 | Yes | Yes |

### Keying Effects (1 effect)
| Category | Effect | ID | Parameters (name: default, min-max) | In Effects.md? | In effects-system.md? |
|----------|--------|----|--------------------------------------|----------------|----------------------|
| keying | Chroma Key | `chroma-key` | keyColor: 'green' (select: green/blue/custom); tolerance: 0.2, 0-1; softness: 0.1, 0-0.5; spillSuppression: 0.5, 0-1 | Yes | Yes |

### Empty Categories (reserved, no effects)
| Category | Status | Notes |
|----------|--------|-------|
| generate | Empty index.ts, no effect subdirectories | Documented as reserved in effects-system.md |
| time | Empty index.ts, no effect subdirectories | Documented as reserved in effects-system.md |
| transition | Empty index.ts, no effect subdirectories | Documented as reserved in effects-system.md |

### Transitions (separate system: src/transitions/)
| Type | ID | Category | Default Duration | Min | Max | In Docs? |
|------|----|----------|-----------------|-----|-----|----------|
| Crossfade | `crossfade` | dissolve | 0.5s | 0.1s | 5.0s | Yes |

**Transition types defined in TypeScript but NOT implemented:** `dip-to-black`, `dip-to-white`, `wipe-left`, `wipe-right` (defined in `TransitionType` union, no corresponding definition files)

**Transition categories defined but empty:** `wipe`, `slide`, `zoom`

## Gap Analysis

### Undocumented Effects
None. All 30 effects from code are documented in both docs files. The effect count matches exactly.

### Inaccurate Documentation

#### 1. CRITICAL: Stale File Path Reference in Effects.md
- **Location:** `docs/Features/Effects.md`, line 332
- **Issue:** Source attribution references `src/components/panels/EffectsPanel.tsx` which does **not exist**
- **Actual file:** The effects UI lives at `src/components/panels/properties/EffectsTab.tsx`
- **Impact:** Developers following this reference will find nothing

#### 2. Uniform Size Documentation Gap (Effects.md)
- **Location:** `docs/Features/Effects.md`, line 289 says "Uniform buffer (16-32 bytes, 16-byte aligned)"
- **Issue:** This is correct but only covers the range. Specific sizes per effect are not documented.
- **Actual sizes from code:**
  - 16 bytes: brightness, contrast, saturation, vibrance, hue-shift, temperature, exposure, box-blur, gaussian-blur, motion-blur, radial-blur, zoom-blur, pixelate, kaleidoscope, mirror, rgb-split, twirl, wave, bulge, edge-detect, grain, posterize, scanlines, sharpen, threshold, vignette
  - 32 bytes: levels (8 floats), glow (8 floats), chroma-key (8 floats)
  - 0 bytes: invert (no uniforms)
- **Severity:** Low - the range statement is not wrong, but "16-32" omits the 0-byte case for invert

#### 3. Default Value Discrepancy: Gaussian Blur Radius
- **Location:** Not explicitly stated in either doc
- **Code:** `gaussian-blur` default radius is **10** (line 19 of gaussian/index.ts)
- **Neither doc lists explicit defaults** for radius parameters in the main effects table, so this is not technically wrong, but both docs could be more precise

#### 4. EffectControls.tsx Not Mentioned in Effects-system.md Architecture Tree
- **Location:** `docs/Features/effects-system.md`, lines 7-27 (architecture tree)
- **Issue:** The tree at line 12 lists `EffectControls.tsx` which exists, but the actual UI rendering in production is done by `src/components/panels/properties/EffectsTab.tsx` which is not mentioned anywhere in either doc file
- **Impact:** The `EffectControls.tsx` in `src/effects/` appears to be a simpler/generic fallback. The real UI with quality sections, batch grouping, keyframe toggles, and DraggableNumber is in `EffectsTab.tsx`

#### 5. Point Parameter Type Listed But Never Used
- **Location:** `docs/Features/effects-system.md`, line 204 documents `point` parameter type as "2D position / XY controls"
- **Code reality:** No effect in the codebase uses the `point` parameter type. The `EffectControls.tsx` has a stub implementation (line 152: `<span>Point control (TODO)</span>`). The `EffectsTab.tsx` does not handle `point` type at all.
- **Severity:** Low - it is documented as a supported type but is effectively unimplemented

#### 6. Color Parameter Type Listed But Never Used
- **Location:** `docs/Features/effects-system.md`, line 203 documents `color` parameter type
- **Code reality:** No effect uses the `color` parameter type. Chroma Key uses `select` with string presets instead. `EffectControls.tsx` has an implementation for it but `EffectsTab.tsx` does not handle it.
- **Severity:** Low - same as point type, documented but unused

#### 7. Animatable Flag Documentation Incomplete
- **Location:** Both docs note that `animatable: true` enables keyframe support
- **Issue:** The docs do not explicitly state which parameters across all effects have `animatable: true` vs `animatable: false` or `undefined`. From code audit:
  - All numeric parameters are `animatable: true` EXCEPT:
    - Quality parameters (`quality: true`): `samples` (gaussian, motion, radial, zoom), `rings` and `samplesPerRing` (glow) - these are all `animatable: false`
    - `speed` in Film Grain and Scanlines: `animatable: false`
  - Boolean parameters: none are marked `animatable`
  - Select parameters: none are marked `animatable`
- **Severity:** Low - the pattern is logical but not explicitly documented

#### 8. Shared Shader Utility Listing Slightly Incomplete
- **Location:** `docs/Features/effects-system.md`, lines 234-237
- **Lists:** `rgb2hsv()`, `hsv2rgb()`, `rgb2hsl()`, `hsl2rgb()`, `hue2rgb()`, `luminance()`, `luminance601()`, `gaussian()`, `smootherstep()`, `hash()`, `noise2d()`, and constants `PI`, `TAU`, `E`
- **Code has:** All of the above plus the `VertexOutput` struct and `vertexMain` function
- **Issue:** The `VertexOutput` struct is mentioned indirectly ("Vertex shader (vertexMain)") but the struct itself is not listed. Very minor.

### Missing Features (post-2026-03-08)
No commits to `src/effects/` or `src/transitions/` since 2026-03-08 (or even since 2026-03-01). No new features to document.

### Stale References

1. **`src/components/panels/EffectsPanel.tsx`** - Referenced in Effects.md line 332 but does not exist. Should be `src/components/panels/properties/EffectsTab.tsx`.

2. **Planned transitions** - Both docs list "Planned: dip-to-black, dip-to-white, wipe-left, wipe-right". The `TransitionType` union in `src/transitions/types.ts` includes these as string literal types, but no implementation files exist. This is accurate as "planned" but the TypeScript types being defined without implementations is a code smell worth noting.

3. **Test file reference** - Effects.md references `tests/unit/effectsRegistry.test.ts` (94 tests) and `tests/unit/typeHelpers.test.ts` (34 tests). The test files exist at the referenced paths, so this is accurate.

### Documentation Quality Issues

1. **Duplicate documentation:** Both `docs/Features/Effects.md` and `docs/Features/effects-system.md` contain overlapping effect inventories with the same parameter lists. When a parameter changes, both files must be updated. Risk of drift.

2. **Effects.md combines too many concerns:** Transform properties, blend modes, GPU effects, keyframes, transitions, and pipeline architecture are all in one file (332 lines). The effects-system.md is more focused on the modular architecture. Consider referencing instead of duplicating.

3. **No documentation of `INLINE_EFFECT_IDS`:** The `EffectsPipeline.ts` (line 12) defines `INLINE_EFFECT_IDS = new Set(['brightness', 'contrast', 'saturation', 'invert'])` - these effects skip pipeline creation. Effects.md (lines 230-235) documents this behavior correctly, but effects-system.md does not mention it at all.

4. **Missing `EffectInstance` type documentation:** Both docs describe `EffectDefinition` thoroughly but neither documents the `EffectInstance` interface (defined in both `types.ts` line 101 and `EffectsPipeline.ts` line 15), which is the runtime representation attached to clips.

## Pipeline Verification

### EffectsPipeline.ts vs Docs
The pipeline description in both docs is **accurate**:
- Ping-pong rendering pattern: confirmed in `applyEffects()` method (lines 166-244)
- Per-effect resources (shader module, bind group layout, render pipeline, uniform buffer): confirmed in `createEffectPipeline()` method (lines 53-106)
- Inline effects skipping pipeline creation: confirmed via `INLINE_EFFECT_IDS` check on line 43
- Audio effect filtering: code filters out `audio-*` prefixed effects (line 178), which is **not documented** in either doc

### Bind Group Structure (from code)
- Binding 0: Sampler (fragment stage)
- Binding 1: Texture (fragment stage)
- Binding 2: Uniform buffer (fragment stage, only if uniformSize > 0)

This matches the shader bindings shown in the effects-system.md example code.

## Transition System Verification

### Completeness
- Registry pattern mirrors effect registry: confirmed
- Only `crossfade` is registered: confirmed
- `TransitionType` union includes unimplemented types: confirmed (code smell)
- `ClipTransition` interface exists for runtime instances: confirmed but not documented in Effects.md

### Duration Bounds
| Property | Code | Docs |
|----------|------|------|
| defaultDuration | 0.5 | 0.5s |
| minDuration | 0.1 | 0.1 (effects-system.md) / not listed (Effects.md) |
| maxDuration | 5.0 | 5.0s (effects-system.md) / not listed (Effects.md) |

Effects.md states "Default Duration: 0.5s" but does not list min/max bounds. Effects-system.md states "0.5s default, 0.1-5.0s range" which is accurate.

## Recommended Changes

### Priority 1 (Critical)
1. **Fix stale file reference** in `docs/Features/Effects.md` line 332: Change `src/components/panels/EffectsPanel.tsx` to `src/components/panels/properties/EffectsTab.tsx`

### Priority 2 (Important)
2. **Document audio effect filtering** in pipeline section: `EffectsPipeline.applyEffects()` silently skips effects with type prefix `audio-`. This behavior should be noted.
3. **Add INLINE_EFFECT_IDS mention** to `docs/Features/effects-system.md` to match the coverage in Effects.md
4. **Add EffectsTab.tsx** to the architecture tree in effects-system.md, noting it is the actual production UI component

### Priority 3 (Low)
5. **Note that `point` and `color` parameter types are defined but unused** by any current effect
6. **Consider consolidating** the duplicate effect inventory tables between the two docs to avoid drift
7. **Document which parameters are non-animatable** (quality params and speed params) explicitly
8. **Remove or annotate** the unimplemented transition types in the TypeScript union to avoid confusion
