import type { OperatorDefinition, OperatorPort, OperatorParameter, OperatorSignal } from '../../types/operatorGraph';
import { WIND_OPERATOR } from './wind';
import { SCENE_OPERATORS } from './sceneOperators';
import { SURFACE_OPERATORS } from './surfaceOperators';

const port = (id: string, type: OperatorSignal, required = false): OperatorPort => ({ id, label: id[0].toUpperCase() + id.slice(1), type, required });
const number = (id: string, label: string, value: number, min: number, max: number): OperatorParameter =>
  ({ id, label, type: 'number', default: value, min, max, step: 0.01, animatable: true });
const stage = (id: string, label: string, inputs: OperatorPort[], outputs: OperatorPort[], parameters: OperatorParameter[] = [],
  invalidates: OperatorDefinition['invalidates'] = 'simulation'): OperatorDefinition =>
  ({ id, version: 1, label, description: label, inputs, outputs, parameters, invalidates, runtime: 'builtin' });

export const EFFECT_OPERATORS: readonly OperatorDefinition[] = [
  ...SCENE_OPERATORS,
  ...SURFACE_OPERATORS,
  WIND_OPERATOR,
  { ...stage('forces.gravity', 'Gravity', [], [port('force', 'force')], [number('strength', 'Strength', 1, -30, 30)]), addable: true, bypass: 'mute' },
  { ...stage('forces.drag', 'Drag', [], [port('drag', 'drag')], [number('amount', 'Damping', 0.4, 0, 20)]), addable: true, bypass: 'mute' },
  { ...stage('values.number', 'Value', [], [port('value', 'number')], [number('value', 'Value', 1, -30, 30)]), addable: true },
  { ...stage('values.oscillator', 'Oscillator', [], [port('value', 'number')], [number('amplitude', 'Amplitude', 1, 0, 30), number('frequency', 'Frequency', 1, 0, 10), number('offset', 'Offset', 0, -30, 30)]), addable: true },
  stage('media.source', 'Video source', [], [port('image', 'image')], [], 'analysis'),
  stage('tracking.face', 'MediaPipe Face Tracker', [port('image', 'image', true)], [port('landmarks', 'landmarks')], [], 'analysis'),
  stage('tracking.smooth', 'Landmark smoothing', [port('landmarks', 'landmarks', true)], [port('landmarks', 'landmarks')], [{ ...number('strength', 'Smoothing', 0, 0, 1), animatable: false }], 'analysis'),
  stage('tracking.anchors', 'Face anchors', [port('landmarks', 'landmarks', true)], [port('anchors', 'anchors')]),
  { ...stage('depth.estimate', 'Depth estimation', [port('image', 'image', true)], [port('depth', 'depth')], [], 'analysis'), bypass: 'mute', runtime: 'worker' },
  stage('surface.hybrid', 'Face + depth surface', [port('landmarks', 'landmarks', true), port('depth', 'depth')], [port('surface', 'surface')]),
  { ...stage('collision.face', 'Face collision', [port('landmarks', 'landmarks', true)], [port('surface', 'surface')]), bypass: 'mute' },
  { ...stage('collision.surface', 'Surface collision', [port('surface', 'surface', true)], [port('surface', 'surface')]), bypass: 'mute' },
  stage('simulation.rope', 'Cable simulation', [port('anchors', 'anchors', true), { ...port('forces', 'force'), repeated: true }, { ...port('drag', 'drag'), repeated: true }, { ...port('colliders', 'surface'), repeated: true }], [port('curves', 'curves')]),
  stage('render.cables', 'Cable rendering', [port('curves', 'curves', true), port('surface', 'geometry')], [port('scene', 'scene')], [
    { id: 'scene3D', label: 'Native 3D', type: 'boolean', default: false },
    { id: 'shadows', label: 'Face shadows (2D)', type: 'boolean', default: false },
  ], 'appearance'),
  stage('scene.transform', 'Transform', [port('scene', 'scene', true)], [port('scene', 'scene')], [], 'appearance'),
  stage('scene.output', 'Clip output', [port('scene', 'scene', true)], [], [], 'appearance'),
];
const registry = new Map(EFFECT_OPERATORS.map(operator => [operator.id, operator]));
export function getEffectOperator(id: string) { return registry.get(id); }
