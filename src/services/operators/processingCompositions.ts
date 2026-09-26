import { extractImageComposition } from './extractImageComposition';
import { createDefaultMotionBlurGraph, createDefaultRadialBlurGraph } from './directionalBlurEffectGraphs';
import { createDefaultContrastGraph, createDefaultSaturationGraph } from './colorEffectGraphs';
import { createDefaultGlowGraph } from './glowEffectGraph';
import { createDefaultEdgeDetectGraph } from './edgeDetectEffectGraph';
import { createDefaultAsciiGraph, createDefaultAsciiGhostGraph } from './asciiEffectGraph';

const ascii = createDefaultAsciiGraph();
const glyphConsumers = ['Image graphs', 'ASCII / Glyph effects'];
/** Versioned recipes, not additional shader implementations. Resource owners stay outside each recipe. */
export const PROCESSING_COMPOSITIONS = [
  extractImageComposition(createDefaultMotionBlurGraph(), {
    id: 'sampling.bounded-count', label: 'Bounded Sample Count',
    description: 'Bound a sample count using explicit lower/upper inputs, preserving the existing max, comparison and selection arithmetic. Truncation remains with the reducer.',
    members: ['samples-at-least-minimum', 'samples-over-maximum', 'count'], captureLiterals: false,
    consumers: ['Image graphs', 'Gaussian Blur', 'Motion Blur', 'Radial Blur', 'Zoom Blur'],
  }),
  extractImageComposition(createDefaultRadialBlurGraph(), {
    id: 'coordinates.centered-scale.vec2', label: 'Scale UV',
    description: 'Scale a direction vector and add its center, using the existing scalar broadcast and vector math.',
    members: ['scale-vec2', 'scaled-direction', 'sample-uv'], consumers: ['Image graphs', 'Radial Blur', 'Zoom Blur'],
  }),
  extractImageComposition(createDefaultSaturationGraph(), {
    id: 'color.luma-saturation.rgb', label: 'Saturation',
    description: 'Mix Rec.601 luminance with the original RGB using an explicit amount. Output is not clamped; alpha stays with the caller.',
    members: ['luma', 'luma-rgb', 'mix'], consumers: ['Image graphs', 'Saturation', 'Vibrance'],
  }),
  extractImageComposition(createDefaultContrastGraph(), {
    id: 'color.contrast-pivot.rgb', label: 'Contrast',
    description: 'Apply RGB contrast around 0.5. Output is not clamped; alpha stays with the caller.',
    members: ['amount-rgb', 'half-rgb', 'subtract-half', 'multiply', 'add-half'], consumers: ['Image graphs', 'Contrast'],
  }),
  extractImageComposition(createDefaultGlowGraph(), {
    id: 'color.soft-bright-pass', label: 'Bright Pass',
    description: 'Rec.709 luminance, smooth lower/upper threshold and RGBA scaling. Threshold edges are explicit inputs.',
    members: ['sample-luma', 'sample-bright', 'bright-sample'], consumers: ['Image graphs', 'Glow'],
  }),
  extractImageComposition(createDefaultEdgeDetectGraph(), {
    id: 'color.sobel-magnitude', label: 'Edge Strength (Taps)',
    description: 'Compute the Sobel magnitude from eight neighboring luminance samples, preserving the original expression order.',
    members: ['negative-tl', 'two-l', 'gx-left-mid', 'gx-left', 'gx-tr', 'two-r', 'gx-right-mid', 'gx',
      'two-t', 'gy-top-mid', 'gy-top', 'gy-bl', 'two-b', 'gy-bottom-mid', 'gy', 'gradient', 'gradient-dot', 'magnitude'],
    consumers: ['Image graphs', 'Edge Detect'],
  }),
  extractImageComposition(ascii, {
    id: 'glyph.cell-grid', label: 'Cell Grid',
    description: 'Pixel-sized glyph grid, cell indices, local coordinates and cell-center UV. Shares the existing minimum cell size and half-cell placement.',
    members: ['safe-cell', 'safe-cell-vec2', 'grid', 'scaled-uv', 'cell-id', 'local-uv', 'half-vec2', 'sample-pixel', 'sample-uv'],
    additionalOutputs: ['safe-cell', 'safe-cell-vec2', 'grid', 'cell-id', 'half-vec2'].map(nodeId => ({ nodeId, portId: 'value' })), consumers: glyphConsumers,
  }),
  extractImageComposition(ascii, {
    id: 'glyph.tone-index', label: 'Tone to Glyph',
    description: 'Optionally invert luminance, clamp below one and map into the glyph count. The tone, invert choice and glyph count are explicit inputs.',
    members: ['inverse-tone', 'mapped-tone', 'clamped-tone', 'safe-count', 'glyph-scaled', 'glyph-index'],
    additionalOutputs: [{ nodeId: 'safe-count', portId: 'value' }], consumers: glyphConsumers,
  }),
  extractImageComposition(ascii, {
    id: 'glyph.atlas-alpha', label: 'Atlas Alpha',
    description: 'Map a glyph index and local cell coordinates into an explicitly supplied atlas. Returns glyph coverage; font loading stays with the atlas source.',
    members: ['safe-columns', 'safe-rows', 'column-ratio', 'atlas-row', 'row-width', 'atlas-column', 'atlas-tile',
      'clamped-local-uv', 'atlas-pixel', 'atlas-size', 'atlas-uv', 'atlas-sample', 'atlas-vec4', 'atlas-split'],
    consumers: glyphConsumers,
  }),
  extractImageComposition(createDefaultAsciiGhostGraph(), {
    id: 'feedback.decay-max-rgba', label: 'Decay Trail',
    description: 'Componentwise max(current, previous * decay). Both frames and decay are explicit inputs; this stateless block never allocates or advances history.',
    members: ['ghost-current', 'ghost-history-value', 'ghost-current-parts', 'ghost-history-parts', 'ghost-resolved', 'ghost-image',
      ...['x', 'y', 'z', 'w'].flatMap(channel => [`ghost-faded-${channel}`, `ghost-max-${channel}`])],
    captureLiterals: false, consumers: ['Image graphs', 'ASCII Ghost'],
  }),
];
