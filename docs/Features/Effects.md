# Effects

[← Back to Index](./README.md)

GPU-accelerated visual effects with 37 blend modes and 30 shader effects.

---

## Table of Contents

- [Transform Properties](#transform-properties)
- [Blend Modes](#blend-modes)
- [GPU Effects](#gpu-effects)
- [Effect Keyframes](#effect-keyframes)
- [Transitions](#transitions)

---

## Transform Properties

Every clip has built-in transform properties (all keyframeable):

### Position
| Property | Range | Default |
|----------|-------|---------|
| X | -∞ to +∞ | 0 |
| Y | -∞ to +∞ | 0 |
| Z | -∞ to +∞ | 0 (depth) |

Position Z enables 3D layer positioning with perspective.

### Scale
| Property | Range | Default |
|----------|-------|---------|
| X | 0% to ∞ | 100% |
| Y | 0% to ∞ | 100% |

### Rotation (3D)
Full 3D rotation with configurable perspective:
| Property | Range | Default |
|----------|-------|---------|
| X | -180° to 180° | 0° |
| Y | -180° to 180° | 0° |
| Z | -180° to 180° | 0° |

### Opacity
| Property | Range | Default |
|----------|-------|---------|
| Opacity | 0% to 100% | 100% |

### Reset to Default
- **Right-click** any property value → resets to default

---

## Blend Modes

### 37 Blend Modes (All Implemented)

#### Normal (3 modes)
| Mode | Description |
|------|-------------|
| `normal` | Standard alpha blending |
| `dissolve` | Random pixel dithering based on opacity |
| `dancing-dissolve` | Animated dithering with time variation |

#### Darken (6 modes)
| Mode | Description |
|------|-------------|
| `darken` | Minimum of base/blend |
| `multiply` | Multiply RGB channels |
| `color-burn` | Color burn intensity |
| `classic-color-burn` | Alternative formula |
| `linear-burn` | `max(base + blend - 1, 0)` |
| `darker-color` | Picks darker by luminosity |

#### Lighten (7 modes)
| Mode | Description |
|------|-------------|
| `add` | Clamped addition (linear dodge) |
| `lighten` | Maximum of base/blend |
| `screen` | `1 - (1-base)*(1-blend)` |
| `color-dodge` | Color dodge intensity |
| `classic-color-dodge` | Alternative formula |
| `linear-dodge` | Same as add |
| `lighter-color` | Picks lighter by luminosity |

#### Contrast (7 modes)
| Mode | Description |
|------|-------------|
| `overlay` | Conditional multiply/screen |
| `soft-light` | Softer version of overlay |
| `hard-light` | Based on blend value |
| `linear-light` | `clamp(base + 2*blend - 1, 0, 1)` |
| `vivid-light` | Conditional dodge/burn |
| `pin-light` | Min/max blend |
| `hard-mix` | Binary threshold (0 or 1) |

#### Inversion (5 modes)
| Mode | Description |
|------|-------------|
| `difference` | Absolute difference |
| `classic-difference` | Same as difference |
| `exclusion` | `base + blend - 2*base*blend` |
| `subtract` | `max(base - blend, 0)` |
| `divide` | `base / max(blend, 0.001)` |

#### Component (4 modes)
| Mode | Description |
|------|-------------|
| `hue` | Blend hue with base sat/lum |
| `saturation` | Blend saturation with base hue/lum |
| `color` | Blend hue/sat with base lum |
| `luminosity` | Blend lum with base hue/sat |

#### Stencil (5 modes)
| Mode | Description |
|------|-------------|
| `stencil-alpha` | Layer alpha as opacity |
| `stencil-luma` | Layer luminosity as opacity |
| `silhouette-alpha` | Inverted layer alpha |
| `silhouette-luma` | Inverted layer luminosity |
| `alpha-add` | Additive alpha blending |

### Blend Mode Cycling
- `Shift` + `+` cycles forward through modes
- `Shift` + `-` cycles backward

---

## GPU Effects

### 30 Modular Effects

Effects are organized by category in `src/effects/`. Each effect is a self-contained module with its own shader and definition file.

#### Color Correction (9 effects)
| Effect | Parameters | Default |
|--------|------------|---------|
| Brightness | amount (-1 to 1) | 0 |
| Contrast | amount (0 to 3) | 0 |
| Saturation | amount (0 to 3) | 0 |
| Vibrance | amount (-1 to 1) | 0 |
| Hue Shift | shift (0 to 1) | 0 |
| Temperature | temperature (-1 to 1), tint (-1 to 1) | 0, 0 |
| Exposure | exposure (-3 to 3 EV), offset (-0.5 to 0.5), gamma (0.2 to 3) | 0, 0, 1 |
| Levels | inputBlack (0-1), inputWhite (0-1), gamma (0.1-3), outputBlack (0-1), outputWhite (0-1) | 0, 1, 1, 0, 1 |
| Invert | (no params) | — |

#### Blur Effects (5 effects)
| Effect | Parameters | Default |
|--------|------------|---------|
| Box Blur | radius (0-20) | 0.02 |
| Gaussian Blur | radius (0-50), **samples** (1-64, quality) | 0.02, 5 |
| Motion Blur | amount (0-0.3), angle (0-TAU), **samples** (4-128, quality) | 0.02, 0, 24 |
| Radial Blur | amount (0-2), centerX (0-1), centerY (0-1), **samples** (4-256, quality) | 0.5, 0.5, 0.5, 32 |
| Zoom Blur | amount (0-1), centerX (0-1), centerY (0-1), **samples** (4-256, quality) | 0.1, 0.5, 0.5, 16 |

#### Distort Effects (7 effects)
| Effect | Parameters | Default |
|--------|------------|---------|
| Pixelate | size (1-64) | 0.05 |
| Kaleidoscope | segments (2-16), rotation (0-TAU) | 6, 0 |
| Mirror | horizontal (bool), vertical (bool) | true, false |
| RGB Split | amount (0-0.1), angle (0-TAU) | 0.01, 0 |
| Twirl | amount (-10 to 10), radius (0.1-1), centerX (0-1), centerY (0-1) | 3, 0.5, 0.5, 0.5 |
| Wave | amplitudeX (0-0.1), amplitudeY (0-0.1), frequencyX (1-20), frequencyY (1-20) | 0.02, 0.02, 5, 5 |
| Bulge/Pinch | amount (0.1-3), radius (0.1-1), centerX (0-1), centerY (0-1) | 1.5, 0.5, 0.5, 0.5 |

#### Stylize Effects (8 effects)
| Effect | Parameters | Default |
|--------|------------|---------|
| Vignette | amount (0-1), size (0-1.5), softness (0-1), roundness (0.5-2) | 0.3, 0.8, 0.5, 1 |
| Film Grain | amount (0-0.5), size (0.5-5), speed (0-5) | 0.15, 1.5, 1 |
| Glow | amount (0-5), threshold (0-1), radius (1-100), softness (0.1-1), **rings** (1-32, quality), **samplesPerRing** (4-64, quality) | 0.3, 0.5, 20, 0.5, 4, 16 |
| Posterize | levels (2-32) | 8 |
| Edge Detect | strength (0-5), invert (bool) | 1, false |
| Scanlines | density (1-20), opacity (0-1), speed (0-5) | 5, 0.5, 1 |
| Threshold | level (0-1) | 0.5 |
| Sharpen | amount (0-5), radius (0.5-5) | 1, 1 |

#### Keying (1 effect)
| Effect | Parameters | Default |
|--------|------------|---------|
| Chroma Key | keyColor (green/blue/custom), tolerance (0-1), softness (0-0.5), spillSuppression (0-1) | green, 0.4, 0.1, 0.5 |

### Effect Controls

#### Bypass Toggle
- Click the **checkmark icon** left of the effect name to toggle effect on/off
- Bypassed effects show as semi-transparent
- Useful for A/B comparisons without removing effects

#### Draggable Values
- **Drag** on any numeric value to adjust it
- **Shift+Drag** for 10x slower precision
- **Ctrl+Drag** for 100x slower precision
- **Right-click** on any value to reset to default

#### Quality Section
Multi-sample effects (blur, glow) have a collapsible **Quality** section with direct control:

| Effect | Quality Parameters |
|--------|-------------------|
| Gaussian Blur | `samples` (1-64, default 5) |
| Zoom Blur | `samples` (4-256, default 16) |
| Motion Blur | `samples` (4-128, default 24) |
| Radial Blur | `samples` (4-256, default 32) |
| Glow | `rings` (1-32, default 4), `samplesPerRing` (4-64, default 16) |

- Click "Quality" header to expand/collapse
- **No upper limit** when dragging values (can go beyond slider max)
- "Reset" button restores defaults
- Warning shown about potential slowdowns

#### Performance Protection
The app monitors render times and **automatically resets quality parameters** to defaults when:
- Frame time exceeds 100ms (below 10fps)
- 5 consecutive slow frames detected

This prevents the app from becoming unresponsive when quality values are set too high.

### Adding Effects
1. Select clip
2. Open Properties Panel → Effects tab
3. Choose effect from dropdown (grouped by category)
4. Adjust parameters with sliders or drag on values

### Inline Effects (Composite Shader)
The following effects run directly inside the composite shader with **no extra render passes**:
- **Brightness**
- **Contrast**
- **Saturation**
- **Invert**

These are optimized for zero overhead since they're applied during compositing.

### Effect Order
All other effects process top-to-bottom (ping-pong rendering).

---

## Effect Keyframes

### Keyframing Effect Parameters
Each numeric effect parameter can be animated:

```typescript
// Property format
`effect.{effectId}.{paramName}`

// Example: animate hue shift
addKeyframe(clipId, 'effect.effect_xyz.shift', 0, 0);    // Start
addKeyframe(clipId, 'effect.effect_xyz.shift', 1, 2);    // End at 2s
```

### Interpolated Effects
```typescript
getInterpolatedEffects(clipId, time)
```
Returns effect parameters with interpolated values at specific time.

### Timeline Display
- Effect keyframes appear below transform properties
- Grouped by effect name
- Only parameters with keyframes shown

---

## GPU Pipeline

### Effects Pipeline Architecture
```
Input Texture
    ↓
Effect 1 → Ping Buffer
    ↓
Effect 2 → Pong Buffer
    ↓
...
    ↓
Final Output
```

### Per-Effect Resources
- Shader module (individual `.wgsl` file per effect)
- Bind group layout
- Render pipeline
- Uniform buffer (0, 16, or 32 bytes, 16-byte aligned) — Invert uses 0, most use 16, levels/glow/chroma-key use 32

### Audio Effect Filtering

`EffectsPipeline.applyEffects()` silently filters out effects with type prefix `audio-` (line 178). Audio effects are processed by the Web Audio API, not the GPU pipeline.

---

## Transitions

Timeline transitions between clips are handled by a separate system in `src/transitions/`.

### Available Transitions
| Type | Category | Default Duration | Min | Max |
|------|----------|-----------------|-----|-----|
| Crossfade | Dissolve | 0.5s | 0.1s | 5.0s |

### Transition Categories

`TransitionCategory` type includes: `'dissolve' | 'wipe' | 'slide' | 'zoom'`. Currently only `dissolve` has implementations; `slide` and `zoom` are reserved but have no transition implementations yet.

### ClipTransition Interface

Defined in `src/transitions/types.ts` (lines 37-46):
```typescript
interface ClipTransition {
  id: string;
  type: string;           // e.g., 'crossfade'
  duration: number;       // seconds
  linkedClipId: string;   // the other clip in the transition
}
```

### Planned Transition Types
- Dip to Black (dissolve)
- Dip to White (dissolve)
- Wipe Left (wipe)
- Wipe Right (wipe)

Transitions are defined as `TransitionDefinition` objects with configurable duration (min/max bounds).

---

## Related Features

- [Masks](./Masks.md) - Shape-based masking
- [Keyframes](./Keyframes.md) - Animation system
- [GPU Engine](./GPU-Engine.md) - Rendering pipeline
- [Keyboard Shortcuts](./Keyboard-Shortcuts.md)

---

## Tests

| Test File | Tests | Coverage |
|-----------|-------|----------|
| [`effectsRegistry.test.ts`](../../tests/unit/effectsRegistry.test.ts) | 94 | Registry, parameters, categories, packUniforms, animatable |
| [`typeHelpers.test.ts`](../../tests/unit/typeHelpers.test.ts) | 34 | Effect property parsing, isAudioEffect |

Run tests: `npx vitest run`

---

## Developer Internals: Effect Plugin System

The effects system uses a modular plugin architecture. Each effect is a self-contained module with its own WGSL shader and TypeScript definition, automatically registered at import time.

### Directory Structure

```
src/effects/
├── index.ts                    # Registry & auto-discovery
├── types.ts                    # EffectDefinition, EffectParam, EffectCategory
├── EffectsPipeline.ts          # GPU pipeline orchestrator
├── EffectControls.tsx          # Generic/simplified UI renderer (fallback)
├── _shared/
│   └── common.wgsl             # Shared vertex shader, color helpers
│
├── color/                      # 9 effects
├── blur/                       # 5 effects
├── distort/                    # 7 effects
├── stylize/                    # 8 effects
├── keying/                     # 1 effect
├── generate/                   # (empty — reserved)
├── time/                       # (empty — reserved)
└── transition/                 # (empty — reserved)
```

**UI note:** `EffectsTab.tsx` (`src/components/panels/properties/EffectsTab.tsx`) is the production UI (primary). `EffectControls.tsx` is a simplified/generic fallback renderer.

### How to Add a New Effect

Each effect is a self-contained module with:
1. **shader.wgsl** - WGSL shader code
2. **index.ts** - Effect definition with metadata

**Step 1: Create the effect module**

```typescript
// src/effects/stylize/my-effect/index.ts
import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';

export const myEffect: EffectDefinition = {
  id: 'my-effect',
  name: 'My Effect',
  category: 'stylize',

  shader,
  entryPoint: 'myEffectFragment',
  uniformSize: 16,

  params: {
    amount: {
      type: 'number',
      label: 'Amount',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
  },

  packUniforms: (params, width, height) => {
    return new Float32Array([
      params.amount as number || 0.5,
      width,
      height,
      0, // padding
    ]);
  },
};
```

**Step 2: Create the shader**

```wgsl
// src/effects/stylize/my-effect/shader.wgsl
struct MyEffectParams {
  amount: f32,
  width: f32,
  height: f32,
  _pad: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: MyEffectParams;

@fragment
fn myEffectFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  // Your effect logic here
  return color;
}
```

**Step 3: Register**

Add export to category index:
```typescript
// src/effects/stylize/index.ts
export { myEffect } from './my-effect';
```

The effect is automatically registered via `src/effects/index.ts` and appears in the UI.

### EffectDefinition Interface

```typescript
interface EffectDefinition {
  id: string;                    // Unique identifier (kebab-case)
  name: string;                  // Display name
  category: EffectCategory;      // Category for grouping
  shader: string;                // WGSL code (imported via ?raw)
  entryPoint: string;            // Fragment shader function name
  uniformSize: number;           // Bytes (must be 16-byte aligned)
  params: Record<string, EffectParam>;
  packUniforms: (params, width, height) => Float32Array | null;
  passes?: number;               // Multi-pass effects
  customControls?: React.ComponentType<EffectControlProps>;
}
```

### EffectInstance Interface

Runtime representation on clips:
```typescript
interface EffectInstance {
  id: string;       // Unique instance ID
  type: string;     // Effect definition ID (e.g., 'gaussian-blur')
  name: string;     // Display name
  enabled: boolean; // Bypass toggle
  params: Record<string, number | boolean | string>;
}
```

### INLINE_EFFECT_IDS Optimization

Brightness, contrast, saturation, and invert are listed in `INLINE_EFFECT_IDS`. These effects are applied as uniforms in the composite shader rather than as separate render passes, resulting in zero additional GPU overhead.

### Parameter Types

| Type | Description | UI Control | Notes |
|------|-------------|------------|-------|
| `number` | Numeric value | Slider / DraggableNumber | Supports `min`, `max`, `step`, `animatable`, `quality` |
| `boolean` | On/off toggle | Checkbox | |
| `select` | Option list | Dropdown | Requires `options` array |
| `color` | Color picker | Color input | Defined but currently unused |
| `point` | 2D position | XY controls | Defined but currently unused |

### Non-Animatable Parameters

Quality parameters and `speed` (used in grain, scanlines) have `animatable: false`. These are shown in collapsible "Quality" sections and are not keyframeable.

### Shared Shader Utilities

The `_shared/common.wgsl` file is prepended to every effect shader and provides:
- **Vertex shader** (`vertexMain`) - Fullscreen quad with UV output
- **Color conversions** - `rgb2hsv()`, `hsv2rgb()`, `rgb2hsl()`, `hsl2rgb()`, `hue2rgb()`
- **Luminance** - `luminance()` (Rec. 709), `luminance601()` (Rec. 601)
- **Math utilities** - `gaussian()`, `smootherstep()`, `hash()`, `noise2d()`
- **Constants** - `PI`, `TAU`, `E`

### Effect Categories

```typescript
type EffectCategory =
  | 'color' | 'blur' | 'distort' | 'stylize'
  | 'generate' | 'keying' | 'time' | 'transition';
```

Categories with no registered effects are hidden from the UI automatically via `getCategoriesWithEffects()`.

---

*Source: `src/effects/` (modular per-effect shaders), `src/shaders/composite.wgsl`, `src/components/panels/properties/EffectsTab.tsx`, `src/transitions/`*
