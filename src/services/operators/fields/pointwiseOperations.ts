import { evaluateScalarOperation } from '../scalarOperationSemantics';
import { imageFract } from '../imageColorSemantics';
import { roundImageScalarEven } from '../imageRoundingSemantics';

/** Value shapes produced by per-element programs; names match the image plan vocabulary. */
export type PointwiseValueType = 'image' | 'rgb' | 'alpha' | 'scalar' | 'boolean' | 'vec2' | 'vec3' | 'vec4';
export type PointwiseValue = number | boolean | number[];

/**
 * A pure, context-free operation evaluated once per element (pixel, curve point, cell).
 * `wgsl` receives already-evaluated argument expressions; `evaluate` is its CPU reference.
 * Operations that read resources, scopes or executor context stay with their owner.
 */
export interface PointwiseOperation {
  wgsl: (args: readonly string[], value?: number) => string;
  evaluate: (args: readonly PointwiseValue[], value?: number) => PointwiseValue;
}

const num = (value: PointwiseValue) => value as number;
const vec = (value: PointwiseValue) => value as number[];
const componentwise = (a: PointwiseValue, b: PointwiseValue, operation: (x: number, y: number) => number) => vec(a).map((value, index) => operation(value, vec(b)[index]));
const binary = (operator: string) => (args: readonly string[]) => `${args[0]} ${operator} ${args[1]}`;
const call = (name: string) => (args: readonly string[]) => `${name}(${args.join(', ')})`;
const identity = { wgsl: (args: readonly string[]) => args[0], evaluate: (args: readonly PointwiseValue[]) => args[0] };

export const POINTWISE_OPERATIONS: Readonly<Record<string, PointwiseOperation>> = {
  'subtract': { wgsl: binary('-'), evaluate: args => evaluateScalarOperation('subtract', num(args[0]), num(args[1])) },
  'add-scalar': { wgsl: binary('+'), evaluate: args => evaluateScalarOperation('add', num(args[0]), num(args[1])) },
  'multiply-scalar': { wgsl: binary('*'), evaluate: args => evaluateScalarOperation('multiply', num(args[0]), num(args[1])) },
  'divide-ieee-scalar': { wgsl: binary('/'), evaluate: args => num(args[0]) / num(args[1]) },
  'reciprocal-scalar': { wgsl: args => `1.0 / ${args[0]}`, evaluate: args => 1 / num(args[0]) },
  'exp2-scalar': { wgsl: call('exp2'), evaluate: args => 2 ** num(args[0]) },
  'exp-scalar': { wgsl: call('exp'), evaluate: args => Math.exp(num(args[0])) },
  'fract-scalar': { wgsl: call('fract'), evaluate: args => imageFract(num(args[0])) },
  'trunc-scalar': { wgsl: call('trunc'), evaluate: args => Math.trunc(num(args[0])) },
  'pass-f32': identity,
  'floor-scalar': { wgsl: call('floor'), evaluate: args => Math.floor(num(args[0])) },
  'round-even-scalar': { wgsl: call('round'), evaluate: args => roundImageScalarEven(num(args[0])) },
  'step-scalar': { wgsl: call('step'), evaluate: args => num(args[1]) < num(args[0]) ? 0 : 1 },
  'sqrt-scalar': { wgsl: call('sqrt'), evaluate: args => Math.sqrt(num(args[0])) },
  'max-scalar': { wgsl: call('max'), evaluate: args => Math.max(num(args[0]), num(args[1])) },
  'min-scalar': { wgsl: call('min'), evaluate: args => evaluateScalarOperation('min', num(args[0]), num(args[1])) },
  'power-scalar': { wgsl: call('pow'), evaluate: args => num(args[0]) ** num(args[1]) },
  'atan2-scalar': { wgsl: call('atan2'), evaluate: args => Math.atan2(num(args[0]), num(args[1])) },
  'tan-scalar': { wgsl: call('tan'), evaluate: args => Math.tan(num(args[0])) },
  'atan-scalar': { wgsl: call('atan'), evaluate: args => Math.atan(num(args[0])) },
  'abs-scalar': { wgsl: call('abs'), evaluate: args => evaluateScalarOperation('abs', num(args[0])) },
  'sin-scalar': { wgsl: call('sin'), evaluate: args => Math.sin(num(args[0])) },
  'cos-scalar': { wgsl: call('cos'), evaluate: args => Math.cos(num(args[0])) },
  'clamp-scalar': { wgsl: args => `clamp(${args[0]}, min(${args[1]}, ${args[2]}), max(${args[1]}, ${args[2]}))`,
    evaluate: args => evaluateScalarOperation('clamp', num(args[0]), num(args[1]), num(args[2])) },
  'greater-scalar': { wgsl: binary('>'), evaluate: args => num(args[0]) > num(args[1]) },
  'and-boolean': { wgsl: binary('&&'), evaluate: args => (args[0] as boolean) && (args[1] as boolean) },
  'smoothstep-scalar': { wgsl: call('smoothstep'), evaluate: args => {
    const t = Math.max(0, Math.min(1, (num(args[2]) - num(args[0])) / (num(args[1]) - num(args[0]))));
    return t * t * (3 - 2 * t);
  } },
  'mix-scalar': { wgsl: call('mix'), evaluate: args => num(args[0]) * (1 - num(args[2])) + num(args[1]) * num(args[2]) },
  'select-scalar': { wgsl: call('select'), evaluate: args => (args[2] as boolean) ? num(args[1]) : num(args[0]) },
  'select-vec2': { wgsl: call('select'), evaluate: args => (args[2] as boolean) ? args[1] : args[0] },
  'add-vec2': { wgsl: binary('+'), evaluate: args => componentwise(args[0], args[1], (a, b) => evaluateScalarOperation('add', a, b)) },
  'subtract-vec2': { wgsl: binary('-'), evaluate: args => componentwise(args[0], args[1], (a, b) => evaluateScalarOperation('subtract', a, b)) },
  'multiply-vec2': { wgsl: binary('*'), evaluate: args => componentwise(args[0], args[1], (a, b) => evaluateScalarOperation('multiply', a, b)) },
  'divide-vec2': { wgsl: binary('/'), evaluate: args => componentwise(args[0], args[1], (a, b) => a / b) },
  'floor-vec2': { wgsl: call('floor'), evaluate: args => vec(args[0]).map(Math.floor) },
  'fract-vec2': { wgsl: call('fract'), evaluate: args => vec(args[0]).map(imageFract) },
  'clamp-vec2': { wgsl: call('clamp'), evaluate: args => vec(args[0]).map((value, index) => Math.max(vec(args[1])[index], Math.min(vec(args[2])[index], value))) },
  'mirror-repeat-vec2': {
    wgsl: args => `select(${args[0]} - floor(${args[0]} * 0.5) * 2.0, vec2f(2.0) - (${args[0]} - floor(${args[0]} * 0.5) * 2.0), (${args[0]} - floor(${args[0]} * 0.5) * 2.0) > vec2f(1.0))`,
    evaluate: args => vec(args[0]).map(value => { const wrapped = value - Math.floor(value * .5) * 2; return wrapped > 1 ? 2 - wrapped : wrapped; }),
  },
  'reduce-min-vec2': { wgsl: args => `min(${args[0]}.x, ${args[0]}.y)`, evaluate: args => Math.min(...vec(args[0])) },
  'dot-vec2': { wgsl: call('dot'), evaluate: args => vec(args[0])[0] * vec(args[1])[0] + vec(args[0])[1] * vec(args[1])[1] },
  'length-vec2': { wgsl: call('length'), evaluate: args => Math.hypot(...vec(args[0])) },
  'unit-direction': { wgsl: args => `vec2f(cos(${args[0]}), sin(${args[0]}))`, evaluate: args => [Math.cos(num(args[0])), Math.sin(num(args[0]))] },
  'scalar-to-vec2': { wgsl: args => `vec2f(${args[0]})`, evaluate: args => [num(args[0]), num(args[0])] },
  'scalar-to-vec4': { wgsl: args => `vec4f(${args[0]})`, evaluate: args => [num(args[0]), num(args[0]), num(args[0]), num(args[0])] },
  'scalar-to-rgb': { wgsl: args => `vec3f(${args[0]})`, evaluate: args => [num(args[0]), num(args[0]), num(args[0])] },
  'multiply-vec4': { wgsl: binary('*'), evaluate: args => componentwise(args[0], args[1], (a, b) => a * b) },
  'divide-vec4': { wgsl: binary('/'), evaluate: args => componentwise(args[0], args[1], (a, b) => a / b) },
  'multiply-vector-scalar': { wgsl: binary('*'), evaluate: args => vec(args[0]).map(value => value * num(args[1])) },
  'divide-vector-scalar': { wgsl: binary('/'), evaluate: args => vec(args[0]).map(value => value / num(args[1])) },
  'clamp-rgb-scalar': { wgsl: args => `clamp(${args[0]}, vec3f(min(${args[1]}, ${args[2]})), vec3f(max(${args[1]}, ${args[2]})))`,
    evaluate: args => vec(args[0]).map(value => evaluateScalarOperation('clamp', value, num(args[1]), num(args[2]))) },
  'split-rgb': { wgsl: args => `${args[0]}.rgb`, evaluate: args => vec(args[0]).slice(0, 3) },
  'split-alpha': { wgsl: args => `${args[0]}.a`, evaluate: args => vec(args[0])[3] },
  'subtract-rgb': { wgsl: binary('-'), evaluate: args => componentwise(args[0], args[1], (a, b) => evaluateScalarOperation('subtract', a, b)) },
  'add-rgb': { wgsl: binary('+'), evaluate: args => componentwise(args[0], args[1], (a, b) => evaluateScalarOperation('add', a, b)) },
  'multiply-rgb': { wgsl: binary('*'), evaluate: args => componentwise(args[0], args[1], (a, b) => evaluateScalarOperation('multiply', a, b)) },
  'divide-ieee-rgb': { wgsl: binary('/'), evaluate: args => componentwise(args[0], args[1], (a, b) => a / b) },
  'max-rgb': { wgsl: call('max'), evaluate: args => componentwise(args[0], args[1], Math.max) },
  'power-rgb': { wgsl: call('pow'), evaluate: args => componentwise(args[0], args[1], (a, b) => a ** b) },
  'floor-rgb': { wgsl: call('floor'), evaluate: args => vec(args[0]).map(Math.floor) },
  'clamp-rgb': { wgsl: args => `clamp(${args[0]}, min(${args[1]}, ${args[2]}), max(${args[1]}, ${args[2]}))`,
    evaluate: args => vec(args[0]).map((value, index) => evaluateScalarOperation('clamp', value, vec(args[1])[index], vec(args[2])[index])) },
  'mix-rgb': { wgsl: call('mix'), evaluate: args => vec(args[0]).map((value, index) => value * (1 - num(args[2])) + vec(args[1])[index] * num(args[2])) },
  'mix-components-rgb': { wgsl: call('mix'),
    evaluate: args => vec(args[0]).map((value, index) => value * (1 - vec(args[2])[index]) + vec(args[1])[index] * vec(args[2])[index]) },
  'reduce-min-rgb': { wgsl: args => `min(min(${args[0]}.r, ${args[0]}.g), ${args[0]}.b)`, evaluate: args => Math.min(...vec(args[0])) },
  'reduce-max-rgb': { wgsl: args => `max(max(${args[0]}.r, ${args[0]}.g), ${args[0]}.b)`, evaluate: args => Math.max(...vec(args[0])) },
  'luminance-rec601': { wgsl: args => `dot(${args[0]}, vec3f(0.299, 0.587, 0.114))`,
    evaluate: args => vec(args[0])[0] * 0.299 + vec(args[0])[1] * 0.587 + vec(args[0])[2] * 0.114 },
  'luminance-rec709': { wgsl: args => `dot(${args[0]}.rgb, vec3f(0.2126, 0.7152, 0.0722))`,
    evaluate: args => vec(args[0])[0] * 0.2126 + vec(args[0])[1] * 0.7152 + vec(args[0])[2] * 0.0722 },
  'vec4-to-rgb': { wgsl: args => `${args[0]}.rgb`, evaluate: args => vec(args[0]).slice(0, 3) },
  'rgb-to-vec3': identity, 'vec3-to-rgb': identity, 'image-to-vec4': identity, 'vec4-to-image': identity,
  'split-component': { wgsl: (args, value) => `${args[0]}[${value}]`, evaluate: (args, value) => vec(args[0])[value ?? 0] },
  'combine-vector': { wgsl: args => `vec${args.length}f(${args.join(', ')})`, evaluate: args => args as number[] },
  'combine': { wgsl: args => `vec4f(${args[0]}, ${args[1]})`, evaluate: args => [...vec(args[0]), num(args[1])] },
};

export function pointwiseOperation(operation: string): PointwiseOperation | undefined {
  return Object.hasOwn(POINTWISE_OPERATIONS, operation) ? POINTWISE_OPERATIONS[operation] : undefined;
}
