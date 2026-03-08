# Modular Effects System

The effects system uses a modular plugin architecture. Each effect is a self-contained module with its own WGSL shader and TypeScript definition, automatically registered at import time.

## Architecture

```
src/effects/
├── index.ts                    # Registry & auto-discovery
├── types.ts                    # EffectDefinition, EffectParam, EffectCategory
├── EffectsPipeline.ts          # GPU pipeline orchestrator
├── EffectControls.tsx          # Generic UI renderer
├── _shared/
│   └── common.wgsl             # Shared vertex shader, color helpers
│
├── color/                      # 9 effects: brightness, contrast, saturation,
│                               #   vibrance, hue-shift, temperature, exposure,
│                               #   levels, invert
├── blur/                       # 5 effects: gaussian, box, radial, zoom, motion
├── distort/                    # 7 effects: pixelate, kaleidoscope, mirror,
│                               #   rgb-split, twirl, wave, bulge
├── stylize/                    # 8 effects: vignette, grain, sharpen, posterize,
│                               #   glow, edge-detect, scanlines, threshold
├── keying/                     # 1 effect: chroma-key
├── generate/                   # (empty — reserved for future generator effects)
├── time/                       # (empty — reserved for future time-based effects)
└── transition/                 # (empty — reserved for future transition effects)
```

Additionally, timeline transitions live in a separate system:

```
src/transitions/
├── index.ts                    # Transition registry
├── types.ts                    # TransitionDefinition, TransitionType
└── crossfade/                  # Crossfade transition definition
```

## Registered Effects (30)

### Color Correction (9)
| Effect | ID | Parameters |
|--------|----|------------|
| Brightness | `brightness` | amount (-1 to 1) |
| Contrast | `contrast` | amount (0 to 3) |
| Saturation | `saturation` | amount (0 to 3) |
| Vibrance | `vibrance` | amount (-1 to 1) |
| Hue Shift | `hue-shift` | shift (0 to 1) |
| Temperature | `temperature` | temperature (-1 to 1), tint (-1 to 1) |
| Exposure | `exposure` | exposure (-3 to 3), offset (-0.5 to 0.5), gamma (0.2 to 3) |
| Levels | `levels` | inputBlack (0-1), inputWhite (0-1), gamma (0.1-3), outputBlack (0-1), outputWhite (0-1) |
| Invert | `invert` | (none) |

### Blur Effects (5)
| Effect | ID | Parameters |
|--------|----|------------|
| Gaussian Blur | `gaussian-blur` | radius (0-50), samples* (1-64, default 5) |
| Box Blur | `box-blur` | radius (0-20) |
| Radial Blur | `radial-blur` | amount (0-2), centerX (0-1), centerY (0-1), samples* (4-256, default 32) |
| Zoom Blur | `zoom-blur` | amount (0-1), centerX (0-1), centerY (0-1), samples* (4-256, default 16) |
| Motion Blur | `motion-blur` | amount (0-0.3), angle (0-TAU), samples* (4-128, default 24) |

*\* = quality parameter (shown in collapsible Quality section)*

### Distort Effects (7)
| Effect | ID | Parameters |
|--------|----|------------|
| Pixelate | `pixelate` | size (1-64) |
| Kaleidoscope | `kaleidoscope` | segments (2-16), rotation (0-TAU) |
| Mirror | `mirror` | horizontal (bool), vertical (bool) |
| RGB Split | `rgb-split` | amount (0-0.1), angle (0-TAU) |
| Twirl | `twirl` | amount (-10 to 10), radius (0.1-1), centerX (0-1), centerY (0-1) |
| Wave | `wave` | amplitudeX (0-0.1), amplitudeY (0-0.1), frequencyX (1-20), frequencyY (1-20) |
| Bulge/Pinch | `bulge` | amount (0.1-3), radius (0.1-1), centerX (0-1), centerY (0-1) |

### Stylize Effects (8)
| Effect | ID | Parameters |
|--------|----|------------|
| Vignette | `vignette` | amount (0-1), size (0-1.5), softness (0-1), roundness (0.5-2) |
| Film Grain | `grain` | amount (0-0.5), size (0.5-5), speed (0-5) |
| Sharpen | `sharpen` | amount (0-5), radius (0.5-5) |
| Posterize | `posterize` | levels (2-32) |
| Glow | `glow` | amount (0-5), threshold (0-1), radius (1-100), softness (0.1-1), rings* (1-32, default 4), samplesPerRing* (4-64, default 16) |
| Edge Detect | `edge-detect` | strength (0-5), invert (bool) |
| Scanlines | `scanlines` | density (1-20), opacity (0-1), speed (0-5) |
| Threshold | `threshold` | level (0-1) |

### Keying Effects (1)
| Effect | ID | Parameters |
|--------|----|------------|
| Chroma Key | `chroma-key` | keyColor (green/blue/custom), tolerance (0-1), softness (0-0.5), spillSuppression (0-1) |

## Adding New Effects

Each effect is a self-contained module with:

1. **shader.wgsl** - WGSL shader code
2. **index.ts** - Effect definition with metadata

### Example: Creating a New Effect

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

### Register the Effect

Add export to category index:

```typescript
// src/effects/stylize/index.ts
export { myEffect } from './my-effect';
```

The effect is automatically registered via `src/effects/index.ts` and appears in the UI.

## Effect Definition Interface

```typescript
interface EffectDefinition {
  id: string;                    // Unique identifier (kebab-case)
  name: string;                  // Display name
  category: EffectCategory;      // Category for grouping

  shader: string;                // WGSL code (imported via ?raw)
  entryPoint: string;            // Fragment shader function name
  uniformSize: number;           // Bytes (must be 16-byte aligned)

  params: Record<string, EffectParam>;

  packUniforms: (
    params: Record<string, number | boolean | string>,
    width: number,
    height: number
  ) => Float32Array | null;

  passes?: number;               // Multi-pass effects
  customControls?: React.ComponentType<EffectControlProps>;  // Custom UI (optional)
}
```

## Parameter Types

| Type | Description | UI Control | Notes |
|------|-------------|------------|-------|
| `number` | Numeric value | Slider / DraggableNumber | Supports `min`, `max`, `step`, `animatable`, `quality` |
| `boolean` | On/off toggle | Checkbox | |
| `select` | Option list | Dropdown | Requires `options` array of `{ value, label }` |
| `color` | Color picker | Color input | |
| `point` | 2D position | XY controls | |

### Special Parameter Flags

| Flag | Type | Description |
|------|------|-------------|
| `animatable` | boolean | Parameter supports keyframe animation (default: undefined/false) |
| `quality` | boolean | Shown in collapsible "Quality" section instead of main params |

## Effect Categories

```typescript
type EffectCategory =
  | 'color'       // Color Correction
  | 'blur'        // Blur & Sharpen
  | 'distort'     // Distort
  | 'stylize'     // Stylize
  | 'generate'    // Generate (reserved)
  | 'keying'      // Keying
  | 'time'        // Time (reserved)
  | 'transition'; // Transition (reserved)
```

Categories with no registered effects are hidden from the UI automatically via `getCategoriesWithEffects()`.

## Shared Shader Utilities

The `_shared/common.wgsl` file is prepended to every effect shader and provides:

- **Vertex shader** (`vertexMain`) - Fullscreen quad with UV output
- **Color conversions** - `rgb2hsv()`, `hsv2rgb()`, `rgb2hsl()`, `hsl2rgb()`, `hue2rgb()`
- **Luminance** - `luminance()` (Rec. 709), `luminance601()` (Rec. 601)
- **Math utilities** - `gaussian()`, `smootherstep()`, `hash()`, `noise2d()`
- **Constants** - `PI`, `TAU`, `E`

## GPU Pipeline

Effects are applied using ping-pong rendering:

1. Input texture → Effect 1 → Ping buffer
2. Ping buffer → Effect 2 → Pong buffer
3. Pong buffer → Effect 3 → Ping buffer
4. ...continue chain...
5. Final buffer → Output

All numeric parameters support keyframe animation when `animatable: true` is set.

## Transition System

Timeline transitions (crossfade, wipes, etc.) are handled separately from effects in `src/transitions/`. They share a similar registry pattern but use `TransitionDefinition` instead of `EffectDefinition`.

Currently registered transitions:
- **Crossfade** (dissolve category) - 0.5s default, 0.1-5.0s range

Planned: dip-to-black, dip-to-white, wipe-left, wipe-right.
