# Effects

[← Back to Index](./README.md)

GPU-accelerated visual effects with 37 blend modes and 9 shader effects.

---

## Table of Contents

- [Transform Properties](#transform-properties)
- [Blend Modes](#blend-modes)
- [GPU Effects](#gpu-effects)
- [Effect Keyframes](#effect-keyframes)

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

### 9 Implemented Effects

#### 1. Hue Shift
- **Parameter**: `shift` (0-1, wrapped)
- **Shader**: RGB↔HSV conversion, hue rotation

#### 2. Brightness
- **Parameter**: `amount` (-1 to +1)
- **Shader**: Additive RGB adjustment

#### 3. Contrast
- **Parameter**: `amount` (0-3, default 1)
- **Shader**: `(color - 0.5) * amount + 0.5`

#### 4. Saturation
- **Parameter**: `amount` (0-3, default 1)
- **Shader**: Mix between grayscale and original

#### 5. Pixelate
- **Parameter**: `size` (1-64 pixels)
- **Shader**: Floor-based pixel block sampling

#### 6. Kaleidoscope
- **Parameters**: `segments` (2-16), `rotation` (0-2π)
- **Shader**: Polar coordinates + sector mirroring

#### 7. Mirror
- **Parameters**: `horizontal` (bool), `vertical` (bool)
- **Shader**: Conditional UV flipping

#### 8. RGB Split
- **Parameters**: `amount` (0-0.1), `angle` (0-2π)
- **Shader**: Offset color channel sampling

#### 9. Levels
- **Parameters**: `inputBlack`, `inputWhite`, `gamma` (0.1-10), `outputBlack`, `outputWhite`
- **Shader**: Input remap → gamma → output remap

#### 10. Invert
- **No parameters**
- **Shader**: `1.0 - color.rgb`

### Adding Effects
1. Select clip
2. Open Effects Panel
3. Click effect to add
4. Adjust parameters with sliders

### Effect Order
Effects process in order listed (ping-pong rendering).

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
- Shader module (from `effects.wgsl`)
- Bind group layout
- Render pipeline
- Uniform buffer (16-32 bytes)

---

## Not Implemented

- Blur effect (defined in types, no shader)
- Motion blur
- Glow/bloom
- Color curves
- Distortion effects
- Particle effects

---

## Related Features

- [Masks](./Masks.md) - Shape-based masking
- [Keyframes](./Keyframes.md) - Animation system
- [GPU Engine](./GPU-Engine.md) - Rendering pipeline
- [Keyboard Shortcuts](./Keyboard-Shortcuts.md)

---

*Source: `src/shaders/effects.wgsl` (243 lines), `src/shaders/composite.wgsl` (743 lines), `src/components/panels/EffectsPanel.tsx`*
