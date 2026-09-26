import type { OperatorDefinition } from '../../types/operatorGraph';
import { createDefaultCrtScreenGraph } from './crtScreenEffectGraph';
import { extractImageComposition } from './extractImageComposition';

const crt = createDefaultCrtScreenGraph();
/** V1 contracts retain the source arithmetic/order. Time and textures are always external signals. */
export const SCREEN_COMPOSITIONS: readonly OperatorDefinition[] = [
  extractImageComposition(crt, {
    id: 'coordinates.radial-curvature.vec2', label: 'Radial Curvature',
    description: 'Center UV in [-1, 1], apply the squared-radius curvature and return normalized UV. Curve and amount are explicit; clamping and sampling stay outside.',
    members: ['two-vec2', 'one-vec2', 'uv-two', 'centered', 'radius-squared', 'radius-curve', 'distortion',
      'warp', 'warped', 'curved-half', 'half-vec2', 'curved'],
    keepLiteralInputs: ['curve'],
    inputLabels: { 'uv-uv': 'UV', 'curve-value': 'Curvature', 'amount-value': 'Amount' },
    outputLabels: { 'curved-value': 'Curved UV' }, consumers: ['Image graphs', 'CRT Screen'],
  }),
  extractImageComposition(crt, {
    id: 'color.rgb-stripe-mask', label: 'Phosphor Stripes',
    description: 'Build repeating RGB phosphor stripes from horizontal UV and pixel width. Stripe width is bounded to at least one pixel; low/high channel levels remain explicit.',
    members: ['safe-scale', 'pixel-x', 'mask-cell', 'mask-floor', 'mask-thirds', 'mask-third-floor', 'mask-third-triple',
      'mask-phase', 'is-red', 'is-blue', 'above-half', 'below-one-half', 'is-green', 'mask-r', 'mask-g', 'mask-b', 'mask-vector', 'mask'],
    keepLiteralInputs: ['mask-low', 'mask-high'],
    inputLabels: { 'scale-value': 'Stripe width (px)', 'uv-split-x': 'UV X', 'resolution-split-x': 'Width (px)',
      'mask-low-value': 'Low level', 'mask-high-value': 'High level' },
    outputLabels: { 'mask-rgb': 'RGB mask' }, consumers: ['Image graphs', 'CRT Screen'],
  }),
  extractImageComposition(crt, {
    id: 'signal.sine-gain.scalar', label: 'Sine Wave',
    description: 'Compute base + amplitude * sin(phase), retaining operand order. Phase is in radians; no internal clock, frequency or clamping.',
    members: ['scan-sine', 'scan-wave', 'scan'], captureLiterals: false,
    inputLabels: { 'scan-angle-value': 'Phase (rad)', 'scan-range-value': 'Amplitude', 'scan-base-value': 'Base' },
    outputLabels: { 'scan-value': 'Gain' }, consumers: ['Image graphs', 'CRT scanlines', 'CRT flicker'],
  }),
  extractImageComposition(crt, {
    id: 'sampling.clamped-image', label: 'Clamped Image Sample',
    description: 'Clamp UV to explicit lower/upper bounds, then sample the supplied image including alpha. Uses the existing image sampler; no extra texture or render pass.',
    members: ['clamped-uv', 'curved-sample'], captureLiterals: false,
    inputLabels: { 'curved-value': 'UV', 'min-vec2-value': 'Minimum UV', 'max-vec2-value': 'Maximum UV', 'frame-image': 'Image' },
    outputLabels: { 'curved-sample-image': 'Sampled image' }, consumers: ['Image graphs', 'CRT Screen', 'Glitch'],
  }),
];
