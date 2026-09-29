import type { PointwiseValueType } from './pointwiseOperations';
import { FIELD_SHAPES } from './fieldFunctions';

/**
 * Declarative lowering of pure registered operators to shared pointwise operations.
 * Every per-element executor (image pixels, curve points, grid cells) lowers these
 * operators identically; owner-specific operators keep their own lowering.
 */
export interface PointwiseLowering {
  operation: string; type: PointwiseValueType;
  /** Input port IDs in instruction argument order. */
  inputs: readonly string[];
  /** Input returned unchanged when the node is bypassed; it is evaluated first. Omitted: bypass has no effect. */
  bypass?: string;
  value?: number;
  /** Inputs that may stay unconnected: they read a node parameter or the evaluated element's position. */
  defaults?: Readonly<Record<string, PointwiseDefault>>;
  /** Node parameter that supplies the instruction value (a choice index or an integer count). */
  valueParameter?: { parameter: string; options?: readonly string[] };
}
export type PointwiseDefault = { parameter: string } | { context: 'position' };
const parameterDefaults = (...ids: string[]) => Object.fromEntries(ids.map(id => [id, { parameter: id }])) as Record<string, PointwiseDefault>;
type LoweringRule = PointwiseLowering | ((output: string) => PointwiseLowering);

const unary = (operation: string, type: PointwiseValueType, input = 'value', bypass?: string): PointwiseLowering =>
  ({ operation, type, inputs: [input], ...(bypass ? { bypass } : {}) });
const passUnary = (operation: string, type: PointwiseValueType = 'scalar') => unary(operation, type, 'value', 'value');
const binaryA = (operation: string, type: PointwiseValueType = 'scalar'): PointwiseLowering => ({ operation, type, inputs: ['a', 'b'], bypass: 'a' });
const clampRule = (operation: string, type: PointwiseValueType): PointwiseLowering => ({ operation, type, inputs: ['value', 'min', 'max'], bypass: 'value' });
const mixB = (operation: string, type: PointwiseValueType): PointwiseLowering => ({ operation, type, inputs: ['a', 'b', 't'], bypass: 'b' });
const splitComponent = (output: string): PointwiseLowering => {
  const component = ['x', 'y', 'z', 'w'].indexOf(output);
  if (component < 0) throw new Error(`Unsupported vector component: ${output}`);
  return { operation: 'split-component', type: 'scalar', inputs: ['value'], value: component };
};
const combine = (size: 2 | 3 | 4): PointwiseLowering => ({ operation: 'combine-vector', type: `vec${size}`, inputs: ['x', 'y', 'z', 'w'].slice(0, size) });

const RULES: Readonly<Record<string, LoweringRule>> = {
  'math.subtract.scalar': { operation: 'subtract', type: 'scalar', inputs: ['a', 'b'], bypass: 'b' },
  'math.add.scalar': binaryA('add-scalar'), 'math.multiply.scalar': binaryA('multiply-scalar'), 'math.divide-ieee.scalar': binaryA('divide-ieee-scalar'),
  'math.reciprocal.scalar': passUnary('reciprocal-scalar'), 'math.exp2.scalar': passUnary('exp2-scalar'), 'math.fract.scalar': passUnary('fract-scalar'),
  'math.floor.scalar': passUnary('floor-scalar'), 'math.round-even.scalar': passUnary('round-even-scalar'),
  'math.step.scalar': { operation: 'step-scalar', type: 'scalar', inputs: ['edge', 'value'] },
  'math.max.scalar': binaryA('max-scalar'), 'math.min.scalar': binaryA('min-scalar'), 'math.power.scalar': binaryA('power-scalar'),
  'math.atan2.scalar': { operation: 'atan2-scalar', type: 'scalar', inputs: ['y', 'x'] },
  'math.tan.scalar': passUnary('tan-scalar'), 'math.atan.scalar': passUnary('atan-scalar'), 'math.abs.scalar': passUnary('abs-scalar'),
  'math.sin.scalar': passUnary('sin-scalar'), 'math.cos.scalar': passUnary('cos-scalar'), 'math.exp.scalar': passUnary('exp-scalar'),
  'math.sqrt.scalar': passUnary('sqrt-scalar'),
  'math.clamp.scalar': clampRule('clamp-scalar', 'scalar'),
  'math.smoothstep.scalar': { operation: 'smoothstep-scalar', type: 'scalar', inputs: ['edge0', 'edge1', 'value'] },
  'math.mix.scalar': { operation: 'mix-scalar', type: 'scalar', inputs: ['a', 'b', 't'], bypass: 'a' },
  'math.add.vec2': binaryA('add-vec2', 'vec2'), 'math.subtract.vec2': binaryA('subtract-vec2', 'vec2'),
  'math.multiply.vec2': binaryA('multiply-vec2', 'vec2'), 'math.divide-ieee.vec2': binaryA('divide-vec2', 'vec2'),
  'math.floor.vec2': passUnary('floor-vec2', 'vec2'), 'math.fract.vec2': passUnary('fract-vec2', 'vec2'),
  'coordinates.mirror-repeat.vec2': passUnary('mirror-repeat-vec2', 'vec2'), 'math.clamp.vec2': clampRule('clamp-vec2', 'vec2'),
  'vector.dot.vec2': { operation: 'dot-vec2', type: 'scalar', inputs: ['a', 'b'] },
  'vector.length.vec2': unary('length-vec2', 'scalar'), 'vector.reduce-min.vec2': unary('reduce-min-vec2', 'scalar'),
  'vector.unit-direction.scalar': unary('unit-direction', 'vec2', 'angle'),
  'convert.scalar-to-vec2': unary('scalar-to-vec2', 'vec2'), 'convert.scalar-to-vec4': unary('scalar-to-vec4', 'vec4'),
  'convert.scalar-to-rgb': unary('scalar-to-rgb', 'rgb'),
  'math.divide-ieee.vec4': binaryA('divide-vec4', 'vec4'), 'math.multiply.vec4': binaryA('multiply-vec4', 'vec4'),
  'math.multiply.image-scalar': binaryA('multiply-vector-scalar', 'image'), 'math.multiply.rgb-scalar': binaryA('multiply-vector-scalar', 'rgb'),
  'math.multiply.vec2-scalar': binaryA('multiply-vector-scalar', 'vec2'),
  'math.divide-ieee.rgb-scalar': binaryA('divide-vector-scalar', 'rgb'), 'math.divide-ieee.vec2-scalar': binaryA('divide-vector-scalar', 'vec2'),
  'math.clamp.rgb-scalar': clampRule('clamp-rgb-scalar', 'rgb'),
  'convert.vec4-to-rgb': unary('vec4-to-rgb', 'rgb'),
  'compare.greater.scalar': { operation: 'greater-scalar', type: 'boolean', inputs: ['a', 'b'] },
  'logic.and.boolean': { operation: 'and-boolean', type: 'boolean', inputs: ['a', 'b'] },
  'select.scalar': { operation: 'select-scalar', type: 'scalar', inputs: ['falseValue', 'trueValue', 'condition'] },
  'select.vec2': { operation: 'select-vec2', type: 'vec2', inputs: ['falseValue', 'trueValue', 'condition'] },
  'convert.image-to-vec4': unary('image-to-vec4', 'vec4', 'image'), 'convert.vec4-to-image': unary('vec4-to-image', 'image'),
  'vector.split.vec2': splitComponent, 'vector.split.vec3': splitComponent, 'vector.split.vec4': splitComponent,
  'vector.combine.vec2': combine(2), 'vector.combine.vec3': combine(3), 'vector.combine.vec4': combine(4),
  'vector.split.rgba': output => output === 'alpha' ? unary('split-alpha', 'alpha', 'image') : unary('split-rgb', 'rgb', 'image'),
  'convert.alpha-to-scalar': unary('pass-f32', 'scalar', 'alpha'), 'convert.scalar-to-alpha': unary('pass-f32', 'alpha'),
  'math.subtract.rgb': { operation: 'subtract-rgb', type: 'rgb', inputs: ['a', 'b'], bypass: 'b' },
  'math.add.rgb': binaryA('add-rgb', 'rgb'), 'math.multiply.rgb': binaryA('multiply-rgb', 'rgb'),
  'math.divide-ieee.rgb': binaryA('divide-ieee-rgb', 'rgb'), 'math.max.rgb': binaryA('max-rgb', 'rgb'), 'math.power.rgb': binaryA('power-rgb', 'rgb'),
  'math.floor.rgb': passUnary('floor-rgb', 'rgb'), 'math.clamp.rgb': clampRule('clamp-rgb', 'rgb'),
  'math.mix.rgb': mixB('mix-rgb', 'rgb'), 'math.mix.vec4': mixB('mix-rgb', 'vec4'), 'math.mix-components.rgb': mixB('mix-components-rgb', 'rgb'),
  'vector.reduce-min.rgb': unary('reduce-min-rgb', 'scalar', 'rgb'), 'vector.reduce-max.rgb': unary('reduce-max-rgb', 'scalar', 'rgb'),
  'color.luminance-rec601.rgb': unary('luminance-rec601', 'scalar', 'rgb'),
  'color.luminance-rec709.rgb': unary('luminance-rec709', 'scalar', 'rgb'), 'color.luminance-rec709.image': unary('luminance-rec709', 'scalar', 'image'),
  'convert.rgb-to-vec3': unary('rgb-to-vec3', 'vec3', 'rgb'), 'convert.vec3-to-rgb': unary('vec3-to-rgb', 'rgb'),
  'vector.combine.rgba': { operation: 'combine', type: 'image', inputs: ['rgb', 'alpha'] },
  'field.shape-distance': { operation: 'shape-distance', type: 'scalar', inputs: ['position', 'center', 'size'],
    defaults: { position: { context: 'position' }, ...parameterDefaults('center', 'size') }, valueParameter: { parameter: 'shape', options: FIELD_SHAPES } },
  'field.noise': { operation: 'noise3', type: 'scalar', inputs: ['position', 'frequency', 'amplitude', 'seed'],
    defaults: { position: { context: 'position' }, ...parameterDefaults('frequency', 'amplitude', 'seed') }, valueParameter: { parameter: 'octaves' } },
  'field.ramp': { operation: 'ramp3', type: 'scalar', inputs: ['value', 'x0', 'y0', 'x1', 'y1', 'x2', 'y2'],
    defaults: parameterDefaults('x0', 'y0', 'x1', 'y1', 'x2', 'y2') },
};

export function pointwiseLoweringFor(operator: string, output: string): PointwiseLowering | undefined {
  const rule = Object.hasOwn(RULES, operator) ? RULES[operator] : undefined;
  return typeof rule === 'function' ? rule(output) : rule;
}

export interface PointwiseInstruction { nodeId: string; operation: string; type: PointwiseValueType; inputs: number[]; value?: number }

/**
 * Lowers one pure node: the bypass input is evaluated first and returned when bypassed.
 * `resolveValue` supplies `valueParameter`; executors without such rules may omit it.
 */
export function lowerPointwiseNode(rule: PointwiseLowering, node: { id: string; bypassed?: boolean },
  visitInput: (input: string) => number, emit: (instruction: PointwiseInstruction) => number,
  resolveValue?: (spec: NonNullable<PointwiseLowering['valueParameter']>) => number): number {
  const passthrough = rule.bypass === undefined ? undefined : visitInput(rule.bypass);
  if (passthrough !== undefined && node.bypassed) return passthrough;
  const inputs = rule.inputs.map(input => input === rule.bypass ? passthrough! : visitInput(input));
  const value = rule.value ?? (rule.valueParameter && resolveValue ? resolveValue(rule.valueParameter) : undefined);
  return emit({ nodeId: node.id, operation: rule.operation, type: rule.type, inputs, ...(value === undefined ? {} : { value }) });
}
