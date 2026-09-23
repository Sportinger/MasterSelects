import type { ImageOperatorEvaluationContext, ImageOperatorPlan } from './imageOperatorGraph';
import { evaluateScalarOperation } from './scalarOperationSemantics';
import { imageFract, imageHsvToRgb, imageRgbToHsv } from './imageColorSemantics';
import { projectImageRadius, rotateImageCoordinate, unprojectImageRadius } from './imageOpticsSemantics';
import { imageDegreesToRadians } from './imageAngleSemantics';
import { normalizeImageVector2 } from './imageVectorSemantics';
import { evaluateImageDerivativeQuad, type ImageDerivativeMode } from './imageOperatorDerivatives';
import { evaluateImageBayer4 } from './imagePatternSemantics';
import { sortImageSegment } from './imageSegmentSortSemantics';
import { partitionImageQuadtree } from './imageQuadtreePartitionSemantics';
import { imageScopeReadsPrimaryInput } from './imageOperatorScopes';
import { roundImageScalarEven } from './imageRoundingSemantics';
import { marchingSquaresTopology } from './marchingSquaresTopology';
import { temporalDeformation } from './motionDeformationMath';
import { evaluateOpticalFlow, evaluateDirectionalSmooth, evaluateMotionConsistency } from './motionImageEvaluation';
import { imageIntegerCellOrigin } from './imageCoordinateSemantics';
import { decodeBytePixel8, decodeBytePixel16, decodeBytePixel32, type BytePixelFloatMode } from './bytePixelSemantics';

const imageHash2d = (value: number[]) => {
  const x = value[0] * 127.1 + value[1] * 311.7, y = value[0] * 269.5 + value[1] * 183.3;
  return imageFract(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453);
};

export function createImageOperatorEvaluator(plan: ImageOperatorPlan) {
  const instructionsByScope = new Map<number, Array<[number, ImageOperatorPlan['instructions'][number]]>>();
  plan.instructions.forEach((instruction, index) => {
    const scope = instruction.scope ?? 0, entries = instructionsByScope.get(scope) ?? [];
    entries.push([index, instruction]); instructionsByScope.set(scope, entries);
  });
  const sampleScopes = new Map(plan.sampleScopes.map(descriptor => [descriptor.id, descriptor]));
  const kernelScopes = new Map(plan.kernelScopes?.map(descriptor => [descriptor.id, descriptor]) ?? []);
  const rectScopes = new Map(plan.rectScopes?.map(descriptor => [descriptor.id, descriptor]) ?? []);
  const sequenceScopes = new Map(plan.sequenceScopes?.map(descriptor => [descriptor.id, descriptor]) ?? []);
  const segmentSortScopes = new Map(plan.segmentSortScopes?.map(descriptor => [descriptor.id, descriptor]) ?? []);
  const quadtreeScopes = new Map(plan.quadtreeScopes?.map(descriptor => [descriptor.id, descriptor]) ?? []);
  const sourceLoadScopes = new Set(plan.sampleScopes.filter(scope => scope.coordinate === 'pixel'
    && imageScopeReadsPrimaryInput(plan.instructions, scope.id)).map(scope => scope.id));
  const derivativeDependencies = new Map<number, ReadonlySet<number>>();
  const collectDependencies = (index: number, result: Set<number>) => {
    if (result.has(index)) return;
    result.add(index);
    const instruction = plan.instructions[index];
    if (instruction.operation === 'select-image' || instruction.operation === 'select-lazy-scalar') {
      collectDependencies(instruction.inputs[0], result);
      instruction.inputs.slice(1).forEach(scope => collectDependencies(sampleScopes.get(scope)!.output, result));
    } else instruction.inputs.forEach(input => collectDependencies(input, result));
    if (instruction.operation === 'sample-image' || instruction.operation === 'load-image') collectDependencies(sampleScopes.get(instruction.value!)!.output, result);
  };
  plan.instructions.forEach(instruction => {
    if (!instruction.operation.startsWith('derivative-')) return;
    const dependencies = new Set<number>(); collectDependencies(instruction.inputs[0], dependencies);
    derivativeDependencies.set(instruction.inputs[0], dependencies);
  });
  return (pixel: [number, number, number, number], context: ImageOperatorEvaluationContext = {}): [number, number, number, number] => {
  if (plan.capabilities.includes('uv') && !context.uv) throw new Error('Image operator plan requires normalized UV context.');
  if (plan.capabilities.includes('resolution') && (!context.resolution || context.resolution.some(value => !Number.isFinite(value) || value <= 0))) {
    throw new Error('Image operator plan requires finite positive resolution context.');
  }
  if (plan.capabilities.includes('time') && (typeof context.timelineTimeSeconds !== 'number' || !Number.isFinite(context.timelineTimeSeconds))) {
    throw new Error('Image operator plan requires finite timeline time context.');
  }
  if (plan.capabilities.includes('sample') && !context.sampleImage) throw new Error('Image operator plan requires an image sampling callback.');
  if (plan.capabilities.includes('pixel-load') && !context.resolution) throw new Error('Image operator plan requires finite resolution for integer pixel loads.');
  if (sourceLoadScopes.size && !context.loadImage) throw new Error('Image operator plan requires an integer image load callback.');
  if ((plan.segmentSortScopes?.length || plan.quadtreeScopes?.length) && (!context.pixelCoordinate || context.pixelCoordinate.some((value, axis) =>
    !Number.isSafeInteger(value) || value < 0 || value >= context.resolution![axis]))) {
    throw new Error('Image scoped pixel operation requires an in-bounds integer pixel coordinate.');
  }
  if (plan.capabilities.includes('derivative')) {
    if (!context.resolution || context.resolution.some(value => !Number.isFinite(value) || value <= 0)) {
      throw new Error('Image derivative evaluation requires finite positive resolution context.');
    }
    if (!context.pixelCoordinate || context.pixelCoordinate.some((value, axis) => !Number.isInteger(value) || value < 0 || value >= context.resolution![axis])) {
      throw new Error('Image derivative evaluation requires an in-bounds integer pixel coordinate.');
    }
    if (!context.sampleImage) throw new Error('Image derivative evaluation requires an image sampling callback.');
  }
  if (plan.instructions.some(item => item.operation === 'resource-input') && !context.sampleResource) throw new Error('Image operator plan requires a materialized resource sampling callback.');
  if (plan.instructions.some(item => item.operation === 'resource-load-input' || item.operation === 'field-load-nearest-seed') && !context.loadResource) {
    throw new Error('Image operator plan requires a materialized resource load callback.');
  }
  if (plan.instructions.some(item => item.operation === 'resource-metadata') && !context.readResourceMetadata) {
    throw new Error('Image operator plan requires a resource metadata callback.');
  }
  if (plan.instructions.some(item => item.operation === 'byte-pixel-decode') && !context.readResourceMetadata) {
    throw new Error('Image operator plan requires an unsigned resource metadata callback.');
  }
  function evaluateScope(scope: number, scopePixel: [number, number, number, number], scopeUv: [number, number] | undefined,
    kernelIndex?: [number, number], sequenceIndex?: number, sequenceT?: number, lexicalValues?: Array<number | boolean | number[]>, filter?: ReadonlySet<number>) {
   const values: Array<number | boolean | number[]> = lexicalValues ? [...lexicalValues] : [];
   const kernelResults = new Map<number, { sum: number[]; weightSum: number }>();
   for (const [instructionIndex, item] of instructionsByScope.get(scope) ?? []) {
    if (filter && !filter.has(instructionIndex)) continue;
    values.length = instructionIndex;
    const args = item.inputs.map(input => values[input]);
    if (item.operation === 'input') values.push(scopePixel);
    else if (item.operation === 'uv') values.push(scopeUv!);
    else if (item.operation === 'sample-input-history') {
      if (!context.sampleInputHistory) throw new Error('Image operator plan requires an input history sampling callback.');
      values.push(context.sampleInputHistory(args[0] as [number, number], Math.max(0, args[1] as number), args[2] as [number, number, number, number]));
    }
    else if (item.operation === 'optical-flow' || item.operation === 'directional-smooth' || item.operation === 'motion-consistency') {
      if (!context.sampleResource) throw new Error('Motion image operators require materialized resource sampling.');
      const sample = (slot: number) => (uv: [number, number]) => context.sampleResource!(plan.resourceInputs![slot], uv);
      values.push(item.operation === 'optical-flow'
        ? evaluateOpticalFlow(sample(item.resourceSlots![0]), sample(item.resourceSlots![1]), scopeUv!, args[0] as number, context.resolution!)
        : item.operation === 'motion-consistency'
        ? evaluateMotionConsistency(sample(item.resourceSlots![0]), scopeUv!, args[0] as number, context.resolution!)
        : evaluateDirectionalSmooth(sample(item.resourceSlots![0]), scopeUv!, args[0] as number[], args[1] as number, args[2] as number, context.resolution!));
    }
    else if (item.operation === 'source-motion') {
      if (item.value === 1) {
        if (!context.sampleDisMotion) throw new Error('DIS requires an explicitly prepared source-pair motion field.');
        values.push(context.sampleDisMotion(item.nodeId, args[0] as [number, number], args[1] as number));
        continue;
      }
      if (!context.sampleMotionHistory) throw new Error('Source motion requires explicit source-history sampling.');
      const uv = args[0] as [number, number], delay = args[1] as number, delta = Math.max(0, Math.min(1, args[2] as number));
        values.push(evaluateOpticalFlow(p => context.sampleMotionHistory!(item.nodeId, p, delay),
          p => context.sampleMotionHistory!(item.nodeId, p, delay + delta), uv, -delta, context.resolution!));
    }
    else if (item.operation === 'temporal-deformation') values.push(temporalDeformation(args[0] as number[], args[1] as number[], args[2] as number[]));
    else if (item.operation === 'mask-overlay') {
      const color = args[0] as number[], tint = args[2] as number[];
      const weight = Math.max(0, Math.min(1, args[1] as number)) * Math.max(0, Math.min(1, args[3] as number));
      values.push([0, 1, 2].map(i => color[i] + (tint[i] - color[i]) * weight).concat(color[3]));
    }
    else if (item.operation === 'resource-input') values.push(context.sampleResource!(plan.resourceInputs![item.value!], scopeUv!));
    else if (item.operation === 'resource-load-input') values.push(context.loadResource!(plan.resourceInputs![item.value!],
      [Math.floor(scopeUv![0] * context.resolution![0]), Math.floor(scopeUv![1] * context.resolution![1])]));
    else if (item.operation === 'field-load-nearest-seed') {
      const pixel = args[0] as [number, number], resolution = context.resolution!;
      values.push(context.loadResource!(plan.resourceInputs![item.value!], [
        Math.max(0, Math.min(resolution[0] - 1, Math.trunc(pixel[0]))), Math.max(0, Math.min(resolution[1] - 1, Math.trunc(pixel[1]))),
      ]));
    }
    else if (item.operation === 'resource-metadata') values.push(context.readResourceMetadata!(plan.resourceInputs![item.value!]));
    else if (item.operation === 'byte-pixel-decode') {
      if (!context.loadUintResource) throw new Error('Image operator plan requires an unsigned resource load callback.');
      const id = plan.resourceInputs![item.value!], metadata = context.readResourceMetadata!(id);
      if (metadata.some(value => !Number.isFinite(value)) || metadata[1] < 1 || metadata[2] < 1) throw new Error(`Unsigned resource ${id} has invalid metadata.`);
      const width = Math.trunc(metadata[1]), height = Math.trunc(metadata[2]), pixel = args[0] as number[];
      const y = Math.max(0, Math.min(height - 1, Math.trunc(pixel[1]))), base = Math.trunc(pixel[0]);
      const load = (x: number) => context.loadUintResource!(id, [Math.max(0, Math.min(width - 1, x)), y]);
      const depth = args[1] as number;
      values.push([...(depth < .5 ? decodeBytePixel8(load(base)) : depth < 1.5 ? decodeBytePixel16(load(base * 2), load(base * 2 + 1))
        : decodeBytePixel32([load(base * 4), load(base * 4 + 1), load(base * 4 + 2), load(base * 4 + 3)],
          ((args[2] as number) < .5 ? 'clamp' : (args[2] as number) < 1.5 ? 'wrap' : 'absolute') as BytePixelFloatMode, args[3] as number))]);
    }
    else if (item.operation === 'kernel-index') values.push(kernelIndex!);
    else if (item.operation === 'sequence-index') values.push(sequenceIndex!);
    else if (item.operation === 'sequence-t') values.push(sequenceT!);
    else if (item.operation === 'resolution') values.push(context.resolution!);
    else if (item.operation === 'time') values.push(context.timelineTimeSeconds!);
    else if (item.operation.startsWith('derivative-')) {
      const mode = item.operation.slice('derivative-'.length) as ImageDerivativeMode;
      values.push(evaluateImageDerivativeQuad(context.pixelCoordinate!, context.resolution!, mode, context.derivativeAutoMode, uv => {
        const sampledPixel = context.sampleImage!(uv);
        return evaluateScope(0, sampledPixel, uv, undefined, undefined, undefined, undefined, derivativeDependencies.get(item.inputs[0]))[item.inputs[0]] as number;
      }));
    }
    else if (item.operation === 'sample-image') {
      const uv = args[0] as [number, number];
      values.push(evaluateScope(item.value!, context.sampleImage!(uv), uv, kernelIndex, sequenceIndex, sequenceT, undefined, filter)[sampleScopes.get(item.value!)!.output]);
    }
    else if (item.operation === 'load-image') {
      const requested = args[0] as [number, number], resolution = context.resolution!;
      const pixel: [number, number] = [Math.max(0, Math.min(resolution[0] - 1, Math.trunc(requested[0]))),
        Math.max(0, Math.min(resolution[1] - 1, Math.trunc(requested[1])))];
      const uv: [number, number] = [(pixel[0] + .5) / resolution[0], (pixel[1] + .5) / resolution[1]];
      const loaded = sourceLoadScopes.has(item.value!) ? context.loadImage!(pixel) : [0, 0, 0, 0] as [number, number, number, number];
      values.push(evaluateScope(item.value!, loaded, uv, kernelIndex, sequenceIndex, sequenceT, undefined, filter)[sampleScopes.get(item.value!)!.output]);
    }
    else if (item.operation === 'segment-sort-luma') {
      const descriptor = segmentSortScopes.get(item.value!);
      if (!descriptor) throw new Error(`Image segment-sort scope ${String(item.value)} is missing.`);
      values.push([...sortImageSegment({ pixel: context.pixelCoordinate!, resolution: context.resolution!, scale: args[0] as number,
        loadPixel: samplePixel => {
          const uv: [number, number] = [(samplePixel[0] + .5) / context.resolution![0], (samplePixel[1] + .5) / context.resolution![1]];
          const loaded = sourceLoadScopes.has(descriptor.id) ? context.loadImage!([samplePixel[0], samplePixel[1]]) : [0, 0, 0, 0] as [number, number, number, number];
          return evaluateScope(descriptor.id, loaded, uv)[descriptor.sample] as [number, number, number, number];
        } }).color]);
    }
    else if (item.operation === 'quadtree-partition') {
      const descriptor = quadtreeScopes.get(item.value!);
      if (!descriptor) throw new Error(`Image quadtree scope ${String(item.value)} is missing.`);
      const result = partitionImageQuadtree({ pixel: context.pixelCoordinate!, resolution: context.resolution!, scale: args[0] as number,
        threshold: args[1] as number, timelineTimeSeconds: args[2] as number, speed: args[3] as number,
        loadPixel: samplePixel => {
          const uv: [number, number] = [(samplePixel[0] + .5) / context.resolution![0], (samplePixel[1] + .5) / context.resolution![1]];
          const loaded = sourceLoadScopes.has(descriptor.id) ? context.loadImage!([samplePixel[0], samplePixel[1]]) : [0, 0, 0, 0] as [number, number, number, number];
          return [...evaluateScope(descriptor.id, loaded, uv)[descriptor.sample] as number[]] as [number, number, number, number];
        } });
      values.push([result.origin[0], result.origin[1], result.size]);
    }
    else if (item.operation === 'quadtree-origin') values.push((args[0] as number[]).slice(0, 2));
    else if (item.operation === 'quadtree-size') values.push((args[0] as number[])[2]);
    else if (item.operation === 'marching-squares-topology') {
      const result = marchingSquaresTopology([args[0] as 0 | 1, args[1] as 0 | 1, args[2] as 0 | 1, args[3] as 0 | 1],
        { top: args[4] as [number, number], right: args[5] as [number, number], bottom: args[6] as [number, number], left: args[7] as [number, number] });
      values.push([...result.a, ...result.b, ...result.c, ...result.d, result.count]);
    }
    else if (item.operation === 'integer-cell-origin') values.push(imageIntegerCellOrigin(args[0] as [number, number], args[1] as number));
    else if (item.operation.startsWith('marching-squares-')) {
      const topology = args[0] as number[], id = item.operation.slice('marching-squares-'.length);
      values.push(id === 'count' ? topology[8] : topology.slice({ a: 0, b: 2, c: 4, d: 6 }[id as 'a' | 'b' | 'c' | 'd'],
        { a: 2, b: 4, c: 6, d: 8 }[id as 'a' | 'b' | 'c' | 'd']));
    }
    else if (item.operation === 'kernel-sum') {
      const extent = Math.max(0, Math.min(64, Math.trunc(args[0] as number)));
      const descriptor = kernelScopes.get(item.value!);
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
      const descriptor = rectScopes.get(item.value!);
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
      const descriptor = sequenceScopes.get(item.value!);
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
    else if (item.operation === 'select-image' || item.operation === 'select-lazy-scalar') {
      const chosenScope = item.inputs[(args[0] as boolean) ? 2 : 1];
      const descriptor = sampleScopes.get(chosenScope)!;
      values.push(evaluateScope(chosenScope, scopePixel, scopeUv, kernelIndex, sequenceIndex, sequenceT, values)[descriptor.output]);
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
    else if (item.operation === 'trunc-scalar') values.push(Math.trunc(args[0] as number));
    else if (item.operation === 'floor-scalar') values.push(Math.floor(args[0] as number));
    else if (item.operation === 'round-even-scalar') values.push(roundImageScalarEven(args[0] as number));
    else if (item.operation === 'step-scalar') values.push((args[1] as number) < (args[0] as number) ? 0 : 1);
    else if (item.operation === 'max-scalar') values.push(Math.max(args[0] as number, args[1] as number));
    else if (item.operation === 'min-scalar') values.push(evaluateScalarOperation('min', args[0] as number, args[1] as number));
    else if (item.operation === 'power-scalar') values.push((args[0] as number) ** (args[1] as number));
    else if (item.operation === 'atan2-scalar') values.push(Math.atan2(args[0] as number, args[1] as number));
    else if (item.operation === 'tan-scalar') values.push(Math.tan(args[0] as number));
    else if (item.operation === 'atan-scalar') values.push(Math.atan(args[0] as number));
    else if (item.operation === 'abs-scalar') values.push(evaluateScalarOperation('abs', args[0] as number));
    else if (item.operation === 'degrees-to-radians') values.push(imageDegreesToRadians(args[0] as number));
    else if (item.operation === 'rotate-vec2') values.push(rotateImageCoordinate(args[0] as number[], args[1] as number));
    else if (item.operation === 'normalize-vec2') values.push(normalizeImageVector2(args[0] as number[]));
    else if (item.operation === 'bayer4-vec2') values.push(evaluateImageBayer4(args[0] as number[]));
    else if (item.operation === 'project-radius') values.push(projectImageRadius(args[0] as number, args[1] as number, args[2] as number));
    else if (item.operation === 'unproject-radius') values.push(unprojectImageRadius(args[0] as number, args[1] as number, args[2] as number));
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
    else if (item.operation === 'select-vec2') values.push((args[2] as boolean) ? args[1] : args[0]);
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
  };
}

export function evaluateImageOperatorPlan(plan: ImageOperatorPlan, pixel: [number, number, number, number],
  context: ImageOperatorEvaluationContext = {}): [number, number, number, number] {
  return createImageOperatorEvaluator(plan)(pixel, context);
}
