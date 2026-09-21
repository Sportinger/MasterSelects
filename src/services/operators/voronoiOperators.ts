import { createComputeEffectParameterSchema } from '../../effects/geometry/computeEffectFactory';
import type { EffectParam } from '../../effects/types';
import type { OperatorDefinition, OperatorParameter, OperatorPort } from '../../types/operatorGraph';

const FIELD_FORMAT = ['nearest-seed-rgba16float'];
const field = (id: string, label: string, required = false): OperatorPort => ({
  id, label, type: 'nearest-seed-field', required, contract: { formats: FIELD_FORMAT },
});
const numberParameter = (id: 'scale' | 'speed', spec: EffectParam): OperatorParameter => {
  if (spec.type !== 'number') throw new Error(`Voronoi ${id} must be a numeric catalog parameter.`);
  return { id, label: spec.label, type: 'number', default: spec.default, min: spec.min, max: spec.max,
    step: spec.step, animatable: spec.animatable };
};
const schema = createComputeEffectParameterSchema({ animated: true });

export const VORONOI_OPERATORS: readonly OperatorDefinition[] = [
  {
    id: 'geometry.voronoi-seeds', version: 1, label: 'Voronoi Seeds',
    description: 'Creates RGBA16F seed records: XY is the seed pixel coordinate, Z is positive when valid, and W is reserved.',
    inputs: [], outputs: [field('field', 'Seed Field')],
    parameters: [numberParameter('scale', schema.scale!), numberParameter('speed', schema.speed!)],
    invalidates: 'appearance', runtime: 'builtin', state: 'stateless', fusion: 'pass-boundary',
    family: 'geometry.voronoi-seeds', consumers: ['voronoi'], implementation: 'local', addable: true,
  },
  {
    id: 'geometry.jump-flood', version: 1, label: 'Jump Flood',
    description: 'Propagates the nearest valid seed pixel record through the RGBA16F field.',
    inputs: [field('field', 'Seed Field', true)], outputs: [field('field', 'Nearest Seed Field')], parameters: [],
    invalidates: 'appearance', runtime: 'builtin', state: 'stateless', fusion: 'pass-boundary',
    family: 'geometry.jump-flood', consumers: ['voronoi'], implementation: 'local', addable: true,
  },
  {
    id: 'field.read-nearest-seed', version: 1, label: 'Read Nearest Seed',
    description: 'Truncates the pixel coordinate, clamps it to the field extent, and exactly loads raw XY seed pixel, Z validity, and reserved W.',
    inputs: [field('field', 'Nearest Seed Field', true), { id: 'pixel', label: 'Pixel', type: 'vec2', required: true }],
    outputs: [{ id: 'value', label: 'Seed Record', type: 'vec4' }], parameters: [],
    invalidates: 'appearance', runtime: 'builtin', state: 'stateless', fusion: 'inline',
    family: 'field.read-nearest-seed', consumers: ['voronoi'], implementation: 'shared', addable: true,
  },
];
