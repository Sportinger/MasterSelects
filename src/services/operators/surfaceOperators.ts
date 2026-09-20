import type { OperatorDefinition, OperatorPort, OperatorSignal, OperatorParameter } from '../../types/operatorGraph';

const port = (id: string, type: OperatorSignal, required = false, formats?: string[], constraints?: string[]): OperatorPort =>
  ({ id, label: id[0].toUpperCase() + id.slice(1), type, required, contract: { ...(formats ? { formats } : {}), ...(constraints ? { constraints } : {}) } });
const number = (id: string, label: string, value: number, min: number, max: number, step = 0.01): OperatorParameter =>
  ({ id, label, type: 'number', default: value, min, max, step, animatable: false });
const op = (id: string, label: string, description: string, inputs: OperatorPort[], outputs: OperatorPort[], parameters: OperatorParameter[] = []): OperatorDefinition =>
  ({ id, version: 1, label, description, inputs, outputs, parameters, runtime: 'builtin', invalidates: 'simulation', addable: true });

export const SURFACE_OPERATORS: readonly OperatorDefinition[] = [
  op('geometry.face', 'Landmarks to face mesh', 'Converts tracked points into geometry using face topology and source-image UVs. Tracking remains a separate input.',
    [port('landmarks', 'landmarks', true, ['face-landmarks'], ['One tracked face; uses its first 468 points for face topology.'])], [port('geometry', 'geometry', false, ['face-mesh'])]),
  op('depth.calibrate', 'Depth calibration', 'Fits relative depth to reference geometry. Without a reference, normalizes it to the source-image size.',
    [port('depth', 'depth', false, ['relative-depth']), port('reference', 'geometry', false, ['face-mesh'], ['Must match the tracked source used by anchors.'])], [port('depth', 'depth', false, ['calibrated-depth'])], [number('strength', 'Depth strength', 1, 0.1, 2)]),
  op('geometry.depth', 'Depth to mesh', 'Reconstructs a UV-mapped image surface from calibrated depth. No MediaPipe dependency.',
    [port('depth', 'depth', false, ['calibrated-depth'])], [port('geometry', 'geometry', false, ['depth-mesh'])]),
  op('geometry.merge-surface', 'Stitch Surfaces', 'Cuts the primary outline from the background, joins the seam to the primary vertices and preserves source UVs.',
    [port('primary', 'geometry', false, ['face-mesh'], ['Closed UV outline; primary vertex positions are preserved.']),
      port('background', 'geometry', false, ['depth-mesh'], ['Depth reconstruction in the same source UV and coordinate space as Primary.'])], [port('geometry', 'geometry', false, ['stitched-mesh'])],
    [number('blendWidth', 'Seam blend', 0.05, 0, 0.2), number('subdivisions', 'Subdivision', 4, 0, 5, 1)]),
  { ...op('collision.mesh', 'Mesh collision', 'Builds a contact surface from connected geometry for the rope solver.',
    [port('geometry', 'geometry', true, ['face-mesh', 'stitched-mesh'], ['Must use the same face or stitched surface as rendering.'])], [port('surface', 'surface')]), bypass: 'mute' },
];
