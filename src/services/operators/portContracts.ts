import { formatsOverlap } from '../nodeGraph/graphConnections';
export { formatsOverlap } from '../nodeGraph/graphConnections';
import type { NodePortContract } from '../../types/nodePortContract';
import type { OperatorPort, OperatorSignal } from '../../types/operatorGraph';

export const SIGNAL_FORMAT_LABELS: Record<string, string> = {
  'decoded-frame': 'Decoded video / still-image frame',
  'rgba-texture': '2D RGBA color texture',
  'uv-transform': 'UV scale + offset (U, V)',
  'surface-material': 'Color texture / solid RGB + opacity',
  'face-mesh': 'Indexed face mesh · XYZ + UV + outline',
  'depth-mesh': 'Reconstructed depth mesh · XYZ + UV',
  'stitched-mesh': 'Stitched surface · XYZ + UV',
  'plane-mesh': 'Image plane · XYZ + UV',
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
  image: contract('Image', 'Image pixels from the source or rendered output. Encoded files are decoded before entering this port.', 'decoded-frame'),
  texture: contract('Texture', 'A sampled two-dimensional color texture. UV coordinates are supplied separately.', 'rgba-texture'),
  uv: contract('UV', 'Source-image sampling coordinates. Transforming UVs changes image placement on the surface, not its geometry.', 'uv-transform'),
  material: contract('Material', 'Surface appearance paired with geometry by a Mesh node.', 'surface-material'),
  geometry: contract('Geometry', 'Spatial geometry with source UV coordinates. Supported mesh representations depend on the receiving node.', 'face-mesh', 'depth-mesh', 'stitched-mesh', 'plane-mesh', 'baked-geometry'),
  landmarks: contract('Landmarks', 'Tracked points before triangulation. All consumers must use the same source and coordinate mapping.', 'face-landmarks'),
  anchors: contract('Anchors', 'Attachment points used by the cable solver.', 'anchor-pairs'),
  depth: contract('Depth', 'One depth value per grid sample. Relative inference must be calibrated before mesh reconstruction.', 'relative-depth', 'calibrated-depth'),
  surface: contract('Collider', 'A contact surface for simulation; it does not carry a rendered material.', 'mesh-collider'),
  force: contract('Force', 'A directional force evaluated by the connected simulation.', 'force-vector'),
  drag: contract('Drag', 'Velocity damping applied by the connected simulation.', 'drag-scalar'),
  curves: contract('Curves', 'Ordered spatial points produced by the cable simulation.', 'rope-curves'),
  scene: contract('Scene', 'Geometry and appearance in a scene. A transform preserves this signal type.', 'scene-object'),
  number: contract('Number', 'A scalar value; it can drive a compatible numeric input.', 'scalar'),
};

export function getOperatorPortContract(port: OperatorPort): NodePortContract {
  return { ...OPERATOR_SIGNAL_CONTRACTS[port.type], ...port.contract };
}
export function operatorPortsCompatible(output: OperatorPort, input: OperatorPort): boolean {
  return output.type === input.type && formatsOverlap(getOperatorPortContract(output).formats, getOperatorPortContract(input).formats);
}
export function signalFormatLabel(format: string): string { return SIGNAL_FORMAT_LABELS[format] ?? format; }
