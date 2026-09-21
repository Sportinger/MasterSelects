import { formatsOverlap } from '../nodeGraph/graphConnections';
export { formatsOverlap } from '../nodeGraph/graphConnections';
import type { NodePortContract } from '../../types/nodePortContract';
import type { OperatorPort, OperatorSignal } from '../../types/operatorGraph';

export const SIGNAL_FORMAT_LABELS: Record<string, string> = {
  'grid-points': 'Grid cell centers',
  'box-primitive': 'Unit box geometry',
  'voxel-grid': 'Instanced boxes with a height field',
  'scalar-field': 'Scalar value at each cell',
  'orbit-camera': 'Perspective orbit camera',
  'relief-light': 'Ambient and directional light',
  'decoded-frame': 'Decoded video / still-image frame',
  'rgba-texture': '2D RGBA color texture',
  'pal-composite-864x313-rgba16f': 'PAL composite signal · 864×313 RGBA16F',
  'receiver-lines-313-rgba16f': 'Receiver line analysis · 313 RGBA16F entries',
  'analog-decoded-360x288-rgba16f': 'Analog decoded image · 360×288 RGBA16F',
  'nearest-seed-rgba16float': 'Nearest-seed field · RGBA16F pixel records',
  'uv-transform': 'UV scale + offset (U, V)',
  'surface-material': 'Color texture / solid RGB + opacity',
  'face-mesh': 'Indexed face mesh · XYZ + UV + outline',
  'depth-mesh': 'Reconstructed depth mesh · XYZ + UV',
  'stitched-mesh': 'Stitched surface · XYZ + UV',
  'plane-mesh': 'Image plane · XYZ + UV',
  'primitive-mesh': 'Native primitive mesh · XYZ + normals',
  'baked-geometry': 'Saved face / depth / cable geometry',
  'face-landmarks': 'MediaPipe face landmarks · normalized XYZ',
  'anchor-pairs': 'Endpoint pairs · XYZ',
  'relative-depth': 'Relative inverse depth · Float32 grid',
  'calibrated-depth': 'Calibrated depth · Float32 grid',
  'mesh-collider': 'Front-surface mesh contact',
  'force-vector': 'Directional force · XYZ',
  'drag-scalar': 'Damping coefficient · scalar',
  'rope-curves': 'Cable polylines · XYZ',
  'scene-object': 'Renderable object / scene contribution',
  scalar: 'Finite scalar number',
};

const contract = (typeLabel: string, description: string, ...formats: string[]): NodePortContract => ({ typeLabel, description, formats });
export const OPERATOR_SIGNAL_CONTRACTS: Record<OperatorSignal, NodePortContract> = {
  audio: contract('Audio samples', 'One value per audio sample and channel. Scalar inputs broadcast without changing sample rate or channel count.', 'audio-samples'),
  rgb: contract('RGB', 'Source RGB channels preserving the source color encoding.', 'source-rgb'),
  alpha: contract('Alpha', 'Straight alpha coverage in the normalized zero-to-one range.', 'straight-alpha'),
  mask: contract('Mask', 'A normalized single-channel image mask.', 'normalized-mask'),
  vec2: contract('Vector 2', 'Two ordered scalar components.', 'vec2'),
  vec3: contract('Vector 3', 'Three ordered scalar components.', 'vec3'),
  vec4: contract('Vector 4', 'Four ordered scalar components.', 'vec4'),
  field: contract('Scalar field', 'A numeric value evaluated at each grid cell in one GPU pass.', 'scalar-field'),
  'nearest-seed-field': contract('Nearest-seed field', 'A frame-local RGBA16F field whose XY stores the nearest seed pixel, Z marks validity, and W is reserved.', 'nearest-seed-rgba16float'),
  camera: contract('Camera', 'Perspective orbit camera used by the relief renderer.', 'orbit-camera'),
  light: contract('Light', 'Directional and ambient relief lighting.', 'relief-light'),
  image: contract('Image', 'Image pixels from the source or rendered output. Encoded files are decoded before entering this port.', 'decoded-frame'),
  'uint32-texture': contract('Unsigned word texture', 'A two-dimensional texture of exact unsigned 32-bit words.', 'r32uint'),
  'pal-signal': contract('PAL signal', 'Frame-local PAL composite samples with fixed signal-grid dimensions.', 'pal-composite-864x313-rgba16f'),
  'receiver-lines': contract('Receiver lines', 'Frame-local receiver analysis rebuilt from the connected PAL signal.', 'receiver-lines-313-rgba16f'),
  texture: contract('Texture', 'A sampled two-dimensional color texture. UV coordinates are supplied separately.', 'rgba-texture'),
  uv: contract('UV', 'Source-image sampling coordinates. Transforming UVs changes image placement on the surface, not its geometry.', 'uv-transform'),
  material: contract('Material', 'Surface appearance paired with geometry by a Mesh node.', 'surface-material'),
  geometry: contract('Geometry', 'Spatial geometry with source UV coordinates. Supported mesh representations depend on the receiving node.', 'face-mesh', 'depth-mesh', 'stitched-mesh', 'plane-mesh', 'primitive-mesh', 'baked-geometry'),
  'primitive-mesh': contract('Primitive mesh', 'Native triangle geometry for reusable Box, Sphere and Cylinder instances.', 'primitive-mesh'),
  landmarks: contract('Landmarks', 'Tracked points before triangulation. All consumers must use the same source and coordinate mapping.', 'face-landmarks'),
  anchors: contract('Anchors', 'Attachment points used by the cable solver.', 'anchor-pairs'),
  depth: contract('Depth', 'One depth value per grid sample. Relative inference must be calibrated before mesh reconstruction.', 'relative-depth', 'calibrated-depth'),
  surface: contract('Collider', 'A contact surface for simulation; it does not carry a rendered material.', 'mesh-collider'),
  force: contract('Force', 'A directional force evaluated by the connected simulation.', 'force-vector'),
  drag: contract('Drag', 'Velocity damping applied by the connected simulation.', 'drag-scalar'),
  curves: contract('Curves', 'Ordered spatial points produced by the cable simulation.', 'rope-curves'),
  scene: contract('Scene', 'Geometry and appearance in a scene. A transform preserves this signal type.', 'scene-object'),
  number: contract('Number', 'A scalar value; it can drive a compatible numeric input.', 'scalar'),
  boolean: contract('Boolean', 'A strict true-or-false condition.', 'boolean'),
};

export function getOperatorPortContract(port: OperatorPort): NodePortContract {
  return { ...OPERATOR_SIGNAL_CONTRACTS[port.type], ...port.contract };
}
export function operatorPortsCompatible(output: OperatorPort, input: OperatorPort): boolean {
  return output.type === input.type && formatsOverlap(getOperatorPortContract(output).formats, getOperatorPortContract(input).formats);
}
export function signalFormatLabel(format: string): string { return SIGNAL_FORMAT_LABELS[format] ?? format; }
