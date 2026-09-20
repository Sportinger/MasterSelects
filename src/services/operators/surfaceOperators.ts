import type { OperatorDefinition, OperatorPort, OperatorSignal, OperatorParameter } from '../../types/operatorGraph';

const port = (id: string, type: OperatorSignal, required = false): OperatorPort => ({ id, label: id[0].toUpperCase() + id.slice(1), type, required });
const number = (id: string, label: string, value: number, min: number, max: number, step = 0.01): OperatorParameter =>
  ({ id, label, type: 'number', default: value, min, max, step, animatable: false });
const op = (id: string, label: string, description: string, inputs: OperatorPort[], outputs: OperatorPort[], parameters: OperatorParameter[] = []): OperatorDefinition =>
  ({ id, version: 1, label, description, inputs, outputs, parameters, runtime: 'builtin', invalidates: 'simulation', addable: true });

export const SURFACE_OPERATORS: readonly OperatorDefinition[] = [
  op('geometry.face', 'Landmarks to face mesh', 'Converts tracked points into geometry using face topology and source-image UVs. Tracking remains a separate input.',
    [port('landmarks', 'landmarks', true)], [port('geometry', 'geometry')]),
  op('depth.calibrate', 'Depth calibration', 'Fits relative depth to reference geometry. Without a reference, normalizes it to the source-image size.',
    [port('depth', 'depth'), port('reference', 'geometry')], [port('depth', 'depth')], [number('strength', 'Depth strength', 1, 0.1, 2)]),
  op('geometry.depth', 'Depth to mesh', 'Reconstructs a UV-mapped image surface from calibrated depth. No MediaPipe dependency.',
    [port('depth', 'depth')], [port('geometry', 'geometry')]),
  op('geometry.merge-surface', 'Merge surface meshes', 'Cuts the primary outline from the background, joins the seam to the primary vertices and preserves source UVs.',
    [port('primary', 'geometry'), port('background', 'geometry')], [port('geometry', 'geometry')],
    [number('blendWidth', 'Seam blend', 0.05, 0, 0.2), number('subdivisions', 'Subdivision', 4, 0, 5, 1)]),
  { ...op('collision.mesh', 'Mesh collision', 'Builds a contact surface from connected geometry for the rope solver.',
    [port('geometry', 'geometry', true)], [port('surface', 'surface')]), bypass: 'mute' },
];
