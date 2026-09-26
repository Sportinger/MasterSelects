import type { OperatorDefinition, OperatorPort } from '../../types/operatorGraph';

const input = (id: string, type: OperatorPort['type'], label: string): OperatorPort => ({ id, type, label, required: true });
const node = (id: string, label: string, description: string, inputs: OperatorPort[], output: OperatorPort): OperatorDefinition => ({
  id, label, description, inputs, outputs: [output], parameters: [], version: 1, invalidates: 'appearance',
  runtime: 'builtin', state: 'stateless', fusion: 'inline', consumers: ['image'], implementation: 'shared', addable: true,
});

/** Motion data uses signed RG UV/second, B confidence, A validity. It is a
 * numeric image field, not display RGB. No decoder or playback state is implicit. */
export const MOTION_IMAGE_OPERATORS: readonly OperatorDefinition[] = [
  { ...node('image.source-motion', 'Source Motion',
    'Forward motion at the connected source delay. DIS cached source pairs uses adjacent original PTS, a GPU pyramid and backward consistency; the interval input applies only to the local estimator. RG = UV per delay-second, B = confidence, A = validity. Requires a source video.',
    [input('uv', 'vec2', 'UV'), input('delay', 'number', 'Delay (s)'), input('interval', 'number', 'Analysis interval (s)')],
    { id: 'image', type: 'image', label: 'Motion field' }),
    parameters: [
      { id: 'denseInverseSearch', label: 'DIS cached source pairs', type: 'boolean', default: false },
      { id: 'stabilize', label: 'Source stabilization', type: 'boolean', default: false },
      { id: 'required', label: 'Wait for analysis', type: 'boolean', default: false },
      { id: 'lookback', label: 'History (s)', type: 'number', default: 4, min: 0, max: 6000, step: .01 },
      { id: 'timeFactor', label: 'Time factor', type: 'number', default: 1, min: 1, max: 100, step: .1 },
    ] },
  node('image.optical-flow', 'Optical Flow',
    'Estimates reference-to-target motion from two explicit images. RG = UV/second, B = confidence, A = validity. Delta is target time minus reference time; zero is invalid. Local estimates can fail on occlusions or large motion.',
    [input('reference', 'image', 'Reference'), input('target', 'image', 'Target'), input('delta', 'number', 'Time interval (s)')],
    { id: 'image', type: 'image', label: 'Motion field' }),
  node('motion.temporal-deformation', 'Temporal Deformation',
    'Estimates local Slit Scan stretch from forward UV/second motion and the delay gradient in seconds per output pixel. X = maximum stretch, Y = minimum stretch, Z = confidence, W = signed determinant. Identity is (1,1).',
    [input('motion', 'image', 'Motion field'), input('gradient', 'vec2', 'Delay gradient'), input('resolution', 'vec2', 'Resolution')],
    { id: 'value', type: 'vec4', label: 'Deformation' }),
  node('image.motion-consistency', 'Motion Confidence',
    'Combines nearby motion vectors using confidence and spatial weights. Disagreement reduces confidence before deformation is measured. Radius is a fraction of the longest image edge; zero preserves the field.',
    [input('image', 'image', 'Motion field'), input('radius', 'number', 'Region radius')],
    { id: 'image', type: 'image', label: 'Consistent motion' }),
  node('image.directional-smooth', 'Directional Smooth',
    'Nine symmetric weighted image samples along a pixel-space direction. Radius is in output pixels, mask controls strength. Zero radius/mask preserves the input.',
    [input('image', 'image', 'Image'), input('direction', 'vec2', 'Direction'), input('radius', 'number', 'Radius (px)'), input('mask', 'number', 'Mask')],
    { id: 'image', type: 'image', label: 'Image' }),
  node('image.mask-overlay', 'Mask Overlay',
    'Overlays a color with mask-weighted opacity while preserving image alpha. This reusable node renders in exports too; preview-only ownership must disable its mask for export.',
    [input('image', 'image', 'Image'), input('mask', 'number', 'Mask'), input('color', 'rgb', 'Color'), input('opacity', 'number', 'Opacity')],
    { id: 'image', type: 'image', label: 'Image' }),
];
