import type { OperatorDefinition, OperatorParameter, OperatorPort, OperatorSignal } from '../../types/operatorGraph';
import { VOXEL_RELIEF_PARAMS } from '../../effects/stylize/voxel-relief/parameters';
import { SCALAR_FIELD_OPERATORS } from './scalarField';

const port = (id: string, type: OperatorSignal, label: string, formats?: string[]): OperatorPort =>
  ({ id, type, label, ...(formats ? { contract: { formats } } : {}) });
const parameters = (group: string): OperatorParameter[] => Object.entries(VOXEL_RELIEF_PARAMS)
  .filter(([, value]) => (value.group ?? 'quality') === group).map(([id, value]) => ({
    id, label: value.label, type: value.type === 'select' ? 'select' : value.type === 'boolean' ? 'boolean' : 'number', default: value.default,
    ...(value.type === 'select' ? { options: value.options } : {}),
    min: value.min, max: value.max, step: value.step, animatable: value.animatable,
  }));
const op = (id: string, label: string, description: string, inputs: OperatorPort[], outputs: OperatorPort[], params: OperatorParameter[], addable = true): OperatorDefinition =>
  ({ id, version: 1, label, description, inputs, outputs, parameters: params, runtime: 'builtin', invalidates: 'appearance', bypass: 'mute', addable });
const primitive = (id: string, label: string, variant: string): OperatorDefinition => ({
  ...op(id, label, `Reusable unit ${label.toLowerCase()}. X and Y scale its footprint within each cell; Z scales the sampled height.`,
    [], [port('geometry', 'geometry', label, ['box-primitive'])], ['width', 'height', 'depth'].map((name, axis) => ({ id: name, label: `Size ${'XYZ'[axis]}`, type: 'number', default: 1, min: 0, max: axis === 2 ? 4 : 1, step: 0.01, animatable: true }))),
  family: 'geometry.primitive', variant,
});

/** Only relief construction and its render controls are new. Image, UV, texture,
 * material and mesh nodes are the existing scene operators. */
export const VOXEL_OPERATORS: readonly OperatorDefinition[] = [
  op('geometry.grid', 'Grid Points', 'Creates a source-aspect grid of cell centers. Columns controls the density in both axes.',
    [], [port('points', 'geometry', 'Points', ['grid-points'])], parameters('relief').filter(param => param.id === 'columns')),
  primitive('geometry.box', 'Primitive', 'box'),
  primitive('geometry.sphere', 'Primitive', 'sphere'),
  primitive('geometry.cylinder', 'Primitive', 'cylinder'),
  op('geometry.instances', 'Instance on Points', 'Places the connected primitive on each grid point and scales its Z axis with the connected height field. Uses instancing in native 3D and the same shape in 2D raymarching.',
    [port('points', 'geometry', 'Points', ['grid-points']), port('geometry', 'geometry', 'Instance', ['box-primitive']), port('height', 'field', 'Height field')],
    [port('geometry', 'geometry', 'Instances', ['voxel-grid'])], parameters('relief').filter(param => ['gap', 'limitToVideo'].includes(param.id))),
  op('geometry.voxel', 'Voxel Relief', 'Extrudes a grid of cells from the connected texture luminance. Disconnect the height texture to mute the geometry.',
    [port('height', 'texture', 'Height texture')], [port('geometry', 'geometry', 'Voxels', ['voxel-grid'])], parameters('relief'), false),
  op('camera.orbit', 'Orbit Camera', 'The relief camera in 2D. Native 3D uses the timeline scene camera instead.',
    [], [port('camera', 'camera', 'Camera')], parameters('camera')),
  op('light.relief', 'Relief Light', 'Directional and ambient relief shading. Disconnect for unlit surface color.',
    [], [port('light', 'light', 'Light')], parameters('light')),
  op('render.voxel', 'Relief Render', 'Renders the connected voxel mesh. Disconnected or muted geometry produces transparency.',
    [port('scene', 'scene', 'Object'), port('camera', 'camera', 'Camera'), port('light', 'light', 'Light')],
    [port('image', 'image', 'Rendered image')], [...parameters('look'), ...parameters('quality')], false),
];

export const VOXEL_SHARED_OPERATOR_IDS = new Set(['image.frame', 'texture.image', 'texture.uv', 'material.surface', 'scene.mesh']);
export function isVoxelOperator(id: string): boolean {
  return VOXEL_SHARED_OPERATOR_IDS.has(id) || VOXEL_OPERATORS.some(operator => operator.id === id) || SCALAR_FIELD_OPERATORS.some(operator => operator.id === id);
}
