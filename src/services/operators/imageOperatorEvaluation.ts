import type { ImageOperatorEvaluationContext, ImageOperatorPlan } from './imageOperatorGraph';
import { evaluateScalarOperation } from './scalarOperationSemantics';
import { imageFract, imageHsvToRgb, imageRgbToHsv } from './imageColorSemantics';

const imageHash2d = (value: number[]) => {
  const x = value[0] * 127.1 + value[1] * 311.7, y = value[0] * 269.5 + value[1] * 183.3;
  return imageFract(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453);
};

export function evaluateImageOperatorPlan(plan: ImageOperatorPlan, pixel: [number, number, number, number], context: ImageOperatorEvaluationContext = {}): [number, number, number, number] {
  if (plan.capabilities.includes('uv') && !context.uv) throw new Error('Image operator plan requires normalized UV context.');
  if (plan.capabilities.includes('resolution') && (!context.resolution || context.resolution.some(value => !Number.isFinite(value) || value <= 0))) {
    throw new Error('Image operator plan requires finite positive resolution context.');
  }
  if (plan.capabilities.includes('time') && (typeof context.timelineTimeSeconds !== 'number' || !Number.isFinite(context.timelineTimeSeconds))) {
    throw new Error('Image operator plan requires finite timeline time context.');
  }
  if (plan.capabilities.includes('sample') && !context.sampleImage) throw new Error('Image operator plan requires an image sampling callback.');
  if (plan.resourceInputs?.length && !context.sampleResource) throw new Error('Image operator plan requires a materialized resource sampling callback.');
  function evaluateScope(scope: number, scopePixel: [number, number, number, number], scopeUv: [number, number] | undefined,
    kernelIndex?: [number, number], sequenceIndex?: number, sequenceT?: number) {
   const values: Array<number | boolean | number[]> = [];
   const kernelResults = new Map<number, { sum: number[]; weightSum: number }>();
   for (const item of plan.instructions) {
    if ((item.scope ?? 0) !== scope) { values.push(0); continue; }
    const args = item.inputs.map(input => values[input]);
    if (item.operation === 'input') values.push(scopePixel);
    else if (item.operation === 'uv') values.push(scopeUv!);
    else if (item.operation === 'resource-input') values.push(context.sampleResource!(plan.resourceInputs![item.value!], scopeUv!));
    else if (item.operation === 'kernel-index') values.push(kernelIndex!);
    else if (item.operation === 'sequence-index') values.push(sequenceIndex!);
    else if (item.operation === 'sequence-t') values.push(sequenceT!);
    else if (item.operation === 'resolution') values.push(context.resolution!);
    else if (item.operation === 'time') values.push(context.timelineTimeSeconds!);
    else if (item.operation === 'sample-image') {
      const uv = args[0] as [number, number]; values.push(evaluateScope(item.value!, context.sampleImage!(uv), uv)[plan.sampleScopes.find(candidate => candidate.id === item.value)!.output]);
    }
    else if (item.operation === 'kernel-sum') {
      const extent = Math.max(0, Math.min(64, Math.trunc(args[0] as number)));
      const descriptor = plan.kernelScopes?.find(candidate => candidate.id === item.value);
      if (!descriptor) throw new Error(`Image kernel scope ${String(item.value)} is missing.`);
      const result = { sum: [0, 0, 0, 0], weightSum: 0 };
      for (let x = -extent; x <= extent; x++) for (let y = -extent; y <= extent; y++) {
        const term = evaluateScope(descriptor.id, scopePixel, scopeUv, [x, y]);
        const sample = term[descriptor.sample] as number[], weight = term[descriptor.weight] as number;
        for (let channel = 0; channel < 4; channel++) result.sum[channel] += sample[channel] * weight;
        result.weightSum += weight;
      }
      kernelResults.set(item.value!, result); values.push(result.sum);
    }
    else if (item.operation === 'kernel-weight-sum') values.push(kernelResults.get(item.value!)!.weightSum);
    else if (item.operation === 'rect-sum') {
      const width = Math.max(1, Math.min(64, Math.trunc(args[0] as number))), height = Math.max(1, Math.min(64, Math.trunc(args[1] as number)));
      const descriptor = plan.rectScopes?.find(candidate => candidate.id === item.value);
      if (!descriptor) throw new Error(`Image rectangular kernel scope ${String(item.value)} is missing.`);
      const result = { sum: [0, 0, 0, 0], weightSum: 0 };
      for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
        const term = evaluateScope(descriptor.id, scopePixel, scopeUv, [x, y]), sample = term[descriptor.sample] as number[], weight = term[descriptor.weight] as number;
        for (let channel = 0; channel < 4; channel++) result.sum[channel] += sample[channel] * weight; result.weightSum += weight;
      }
      kernelResults.set(item.value!, result); values.push(result.sum);
    }
    else if (item.operation === 'rect-weight-sum') values.push(kernelResults.get(item.value!)!.weightSum);
    else if (item.operation === 'sequence-sum') {
      const count = Math.max(1, Math.min(256, Math.trunc(args[0] as number)));
      const descriptor = plan.sequenceScopes?.find(candidate => candidate.id === item.value);
      if (!descriptor) throw new Error(`Image sequence scope ${String(item.value)} is missing.`);
      const result = { sum: [0, 0, 0, 0], weightSum: 0 };
      for (let index = 0; index < count; index++) {
        const t = count === 1 ? 0 : index / (count - 1), term = evaluateScope(descriptor.id, scopePixel, scopeUv, undefined, index, t);
        const sample = term[descriptor.sample] as number[], weight = term[descriptor.weight] as number;
        for (let channel = 0; channel < 4; channel++) result.sum[channel] += sample[channel] * weight;
        result.weightSum += weight;
      }
      kernelResults.set(item.value!, result); values.push(result.sum);
    }
    else if (item.operation === 'sequence-weight-sum') values.push(kernelResults.get(item.value!)!.weightSum);
    else if (item.operation === 'select-image') {
      const chosenScope = item.inputs[(args[0] as boolean) ? 2 : 1];
      const descriptor = plan.sampleScopes.find(candidate => candidate.id === chosenScope)!;
      values.push(evaluateScope(chosenScope, scopePixel, scopeUv)[descriptor.output]);
    }
    else if (item.operation === 'constant') values.push(item.type === 'boolean' ? Boolean(item.value) : item.value ?? 0);
    else if (item.operation === 'parameter') values.push(plan.values[item.value ?? 0]);
    else if (item.operation === 'parameter-boolean') values.push(plan.values[item.value ?? 0] > 0.5);
    else if (item.operation === 'parameter-color') values.push(plan.values.slice(item.value ?? 0, (item.value ?? 0) + 4));
    else if (item.operation === 'constant-color') values.push(item.color!);
    else if (item.operation === 'subtract') values.push(evaluateScalarOperation('subtract', args[0] as number, args[1] as number));
    else if (item.operation === 'add-scalar') values.push(evaluateScalarOperation('add', args[0] as number, args[1] as number));
    else if (item.operation === 'multiply-scalar') values.push(evaluateScalarOperation('multiply', args[0] as number, args[1] as number));
    else if (item.operation === 'divide-ieee-scalar') values.push((args[0] as number) / (args[1] as number));
    else if (item.operation === 'reciprocal-scalar') values.push(1 / (args[0] as number));
    else if (item.operation === 'exp2-scalar') values.push(2 ** (args[0] as number));
    else if (item.operation === 'exp-scalar') values.push(Math.exp(args[0] as number));
    else if (item.operation === 'gaussian-scalar') values.push(Math.exp(-((args[0] as number) ** 2) / ((2 * (args[1] as number)) * (args[1] as number))));
    else if (item.operation === 'sqrt-scalar') values.push(Math.sqrt(args[0] as number));
    else if (item.operation === 'fract-scalar') values.push(imageFract(args[0] as number));
    else if (item.operation === 'floor-scalar') values.push(Math.floor(args[0] as number));
    else if (item.operation === 'step-scalar') values.push((args[1] as number) < (args[0] as number) ? 0 : 1);
    else if (item.operation === 'max-scalar') values.push(Math.max(args[0] as number, args[1] as number));
    else if (item.operation === 'clamp-scalar') values.push(evaluateScalarOperation('clamp', args[0] as number, args[1] as number, args[2] as number));
    else if (item.operation === 'and-boolean') values.push((args[0] as boolean) && (args[1] as boolean));
    else if (item.operation === 'smoothstep-scalar') {
      const t = Math.max(0, Math.min(1, ((args[2] as number) - (args[0] as number)) / ((args[1] as number) - (args[0] as number))));
      values.push(t * t * (3 - 2 * t));
    }
    else if (item.operation === 'mix-scalar') values.push((args[0] as number) * (1 - (args[2] as number)) + (args[1] as number) * (args[2] as number));
    else if (item.operation === 'add-vec2') values.push((args[0] as number[]).map((value, index) => evaluateScalarOperation('add', value, (args[1] as number[])[index])));
    else if (item.operation === 'subtract-vec2') values.push((args[0] as number[]).map((value, index) => evaluateScalarOperation('subtract', value, (args[1] as number[])[index])));
    else if (item.operation === 'multiply-vec2') values.push((args[0] as number[]).map((value, index) => evaluateScalarOperation('multiply', value, (args[1] as number[])[index])));
    else if (item.operation === 'divide-vec2') values.push((args[0] as number[]).map((value, index) => value / (args[1] as number[])[index]));
    else if (item.operation === 'floor-vec2') values.push((args[0] as number[]).map(Math.floor));
    else if (item.operation === 'fract-vec2') values.push((args[0] as number[]).map(imageFract));
    else if (item.operation === 'clamp-vec2') values.push((args[0] as number[]).map((value, index) => Math.max((args[1] as number[])[index], Math.min((args[2] as number[])[index], value))));
    else if (item.operation === 'mirror-repeat-vec2') values.push((args[0] as number[]).map(value => { const wrapped = value - Math.floor(value * .5) * 2; return wrapped > 1 ? 2 - wrapped : wrapped; }));
    else if (item.operation === 'reduce-min-vec2') values.push(Math.min(...args[0] as number[]));
    else if (item.operation === 'hash2d-vec2') values.push(imageHash2d(args[0] as number[]));
    else if (item.operation === 'dot-vec2') values.push((args[0] as number[])[0] * (args[1] as number[])[0] + (args[0] as number[])[1] * (args[1] as number[])[1]);
    else if (item.operation === 'length-vec2') values.push(Math.hypot(...args[0] as number[]));
    else if (item.operation === 'unit-direction') values.push([Math.cos(args[0] as number), Math.sin(args[0] as number)]);
    else if (item.operation === 'sin-scalar') values.push(Math.sin(args[0] as number));
    else if (item.operation === 'cos-scalar') values.push(Math.cos(args[0] as number));
    else if (item.operation === 'scalar-to-vec2') values.push([args[0] as number, args[0] as number]);
    else if (item.operation === 'scalar-to-vec4') values.push([args[0] as number, args[0] as number, args[0] as number, args[0] as number]);
    else if (item.operation === 'multiply-vec4') values.push((args[0] as number[]).map((value, index) => value * (args[1] as number[])[index]));
    else if (item.operation === 'multiply-vector-scalar') values.push((args[0] as number[]).map(value => value * (args[1] as number)));
    else if (item.operation === 'divide-vector-scalar') values.push((args[0] as number[]).map(value => value / (args[1] as number)));
    else if (item.operation === 'clamp-rgb-scalar') values.push((args[0] as number[]).map(value => evaluateScalarOperation('clamp', value, args[1] as number, args[2] as number)));
    else if (item.operation === 'divide-vec4') values.push((args[0] as number[]).map((value, index) => value / (args[1] as number[])[index]));
    else if (item.operation === 'greater-scalar') values.push((args[0] as number) > (args[1] as number));
    else if (item.operation === 'select-scalar') values.push((args[2] as boolean) ? args[1] as number : args[0] as number);
    else if (item.operation === 'split-rgb') values.push((args[0] as number[]).slice(0, 3));
    else if (item.operation === 'split-alpha') values.push((args[0] as number[])[3]);
    else if (item.operation === 'subtract-rgb') values.push((args[0] as number[]).map((channel, index) => evaluateScalarOperation('subtract', channel, (args[1] as number[])[index])));
    else if (item.operation === 'add-rgb') values.push((args[0] as number[]).map((channel, index) => evaluateScalarOperation('add', channel, (args[1] as number[])[index])));
    else if (item.operation === 'multiply-rgb') values.push((args[0] as number[]).map((channel, index) => evaluateScalarOperation('multiply', channel, (args[1] as number[])[index])));
    else if (item.operation === 'divide-ieee-rgb') values.push((args[0] as number[]).map((channel, index) => channel / (args[1] as number[])[index]));
    else if (item.operation === 'max-rgb') values.push((args[0] as number[]).map((channel, index) => Math.max(channel, (args[1] as number[])[index])));
    else if (item.operation === 'power-rgb') values.push((args[0] as number[]).map((channel, index) => channel ** (args[1] as number[])[index]));
    else if (item.operation === 'floor-rgb') values.push((args[0] as number[]).map(Math.floor));
    else if (item.operation === 'clamp-rgb') values.push((args[0] as number[]).map((channel, index) => evaluateScalarOperation('clamp', channel, (args[1] as number[])[index], (args[2] as number[])[index])));
    else if (item.operation === 'mix-rgb') values.push((args[0] as number[]).map((channel, index) => channel * (1 - (args[2] as number)) + (args[1] as number[])[index] * (args[2] as number)));
    else if (item.operation === 'mix-components-rgb') values.push((args[0] as number[]).map((channel, index) => channel * (1 - (args[2] as number[])[index]) + (args[1] as number[])[index] * (args[2] as number[])[index]));
    else if (item.operation === 'reduce-min-rgb') values.push(Math.min(...args[0] as number[]));
    else if (item.operation === 'reduce-max-rgb') values.push(Math.max(...args[0] as number[]));
    else if (item.operation === 'luminance-rec601') values.push((args[0] as number[])[0] * 0.299 + (args[0] as number[])[1] * 0.587 + (args[0] as number[])[2] * 0.114);
    else if (item.operation === 'luminance-rec709') values.push((args[0] as number[])[0] * 0.2126 + (args[0] as number[])[1] * 0.7152 + (args[0] as number[])[2] * 0.0722);
    else if (item.operation === 'scalar-to-rgb') values.push([args[0] as number, args[0] as number, args[0] as number]);
    else if (item.operation === 'vec4-to-rgb') values.push((args[0] as number[]).slice(0, 3));
    else if (item.operation === 'rgb-to-vec3' || item.operation === 'vec3-to-rgb') values.push(args[0]);
    else if (item.operation === 'rgb-to-hsv') values.push(imageRgbToHsv(args[0] as [number, number, number]));
    else if (item.operation === 'hsv-to-rgb') values.push(imageHsvToRgb(args[0] as [number, number, number]));
    else if (item.operation === 'image-to-vec4' || item.operation === 'vec4-to-image') values.push(args[0]);
    else if (item.operation === 'split-component') values.push((args[0] as number[])[item.value ?? 0]);
    else if (item.operation === 'combine-vector') values.push(args as number[]);
    else values.push([...(args[0] as number[]), args[1] as number]);
   }
   return values;
  }
  const values = evaluateScope(0, pixel, context.uv);
  const result = values[plan.output], type = plan.instructions[plan.output].type;
  if (type === 'image' || type === 'vec4') return result as [number, number, number, number];
  if (type === 'rgb' || type === 'vec3') return [...result as number[], 1] as [number, number, number, number];
  if (type === 'vec2') return [...result as number[], 0, 1] as [number, number, number, number];
  if (type === 'boolean') { const value = result ? 1 : 0; return [value, value, value, 1]; }
  return [result as number, result as number, result as number, 1];
}
